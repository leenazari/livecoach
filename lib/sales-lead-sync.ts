import 'server-only';
import { supabaseService as db } from '@/lib/supabase';
import { replyEvent, trackingIdentity } from '@/lib/sales-lead-events';
type Scope = { workspaceId: string; userId: string };
type Source = { company_id: string; source_ref: string; source_lead_id?: string; landing_page_url?: string };
type Event = { company: string; source: string; type: string; ref: string; at: string };
const chunks = <T,>(rows: T[], size = 100) => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
async function rows(query: any): Promise<any[]> { const { data, error } = await query; if (error) throw error; return data || []; }
export async function syncSalesLeadFeed(scope: Scope) {
  const configs = await rows(db.from('sales_lead_connections').select('workspace_id,owner_id,enabled').eq('source', 'adam').eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('enabled', true));
  if (!configs.length) return { connected: false, imported: 0, events: 0, review: 0 };
  const members = await rows(db.from('workspace_members').select('role').eq('workspace_id', scope.workspaceId).eq('user_id', scope.userId).eq('status', 'active').eq('role', 'owner'));
  if (!members.length) throw new Error('sales_lead_access');
  let imported = 0, review = 0, applied = 0;
  const pending = await rows(db.rpc('pending_sales_leads_service', { p_workspace: scope.workspaceId, p_actor: scope.userId }));
  for (const lead of pending) {
    const { error } = await db.rpc('intake_sales_lead_service', { p_workspace: scope.workspaceId, p_actor: scope.userId, p_lead: lead.id });
    if (error) {
      const reason = /sales_lead_[a-z_]+/.exec(error.message || '')?.[0];
      if (!reason || reason === 'sales_lead_access') throw error;
      const saved = await db.from('sales_lead_reviews').upsert({ workspace_id: scope.workspaceId, source_lead_id: lead.id, reason, retry_after: new Date(Date.now() + 86400000).toISOString() }, { onConflict: 'workspace_id,source_lead_id' });
      if (saved.error) throw saved.error;
      review++;
    } else imported++;
  }
  // Page in the database. There is no LLM work, campaign launch or email send.
  const sources: Source[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await rows(db.from('sales_lead_sources').select('company_id,source_ref,source_lead_id,landing_page_url').eq('workspace_id', scope.workspaceId).order('id').range(offset, offset + 499));
    sources.push(...batch); if (batch.length < 500) break;
  }
  // Exact legacy page identities allow old sheet links to receive visit signals without inventing campaign attribution.
  for (let offset = 0; ; offset += 500) {
    const companies = await rows(db.from('companies').select('id,lead:attributes->importedLead').eq('workspace_id', scope.workspaceId).contains('attributes', { importedLead: { version: 1 } }).eq('is_confidential', false).order('id').range(offset, offset + 499));
    for (const c of companies) if (c.lead?.sourceRef && !sources.some(s => s.company_id === c.id && s.source_ref === c.lead.sourceRef)) sources.push({ company_id: c.id, source_ref: c.lead.sourceRef, landing_page_url: c.lead.holdingPageUrl });
    if (companies.length < 500) break;
  }
  const events: Event[] = [];
  for (const batch of chunks(sources, 50)) {
    const identity = new Map<string, Source[]>();
    for (const source of batch) { const key = trackingIdentity(source.landing_page_url); if (key) { const id = `${key.slug}\0${key.token}`; identity.set(id, [...(identity.get(id) || []), source]); } }
    const tokens = [...identity.keys()].map(key => key.split('\0')[1]);
    if (tokens.length) {
      for (const [table, atColumn] of [['adam_demo_clicks', 'clicked_at'], ['adam_pipeline_events', 'created_at']] as const) {
        const tracking = await rows(db.from(table).select(`id,slug,token,event,${atColumn}`).in('token', tokens).order(atColumn, { ascending: false }).limit(500));
        for (const hit of tracking) {
          const matches = sources.filter(s => { const k = trackingIdentity(s.landing_page_url); return !!k && k.token === hit.token && k.slug === hit.slug; });
          const companyIds = new Set(matches.map(s => s.company_id));
          if (companyIds.size !== 1) continue;
          const source = matches.find(s => s.source_lead_id) || matches[0];
          if (['page_view', 'demo_start', 'demo_completed'].includes(hit.event)) events.push({ company: source.company_id, source: source.source_ref, type: hit.event, ref: `${table}:${hit.id}`, at: hit[atColumn] });
        }
      }
      for (const [table, atColumn] of [['adam_unsubscribes', 'unsubscribed_at'], ['adam_pipeline_unsubscribes', 'marked_at']] as const) {
        for (const hit of await rows(db.from(table).select(`token,${atColumn}`).in('token', tokens).limit(500))) {
          const matches = sources.filter(s => trackingIdentity(s.landing_page_url)?.token === hit.token);
          if (new Set(matches.map(s => s.company_id)).size !== 1) continue;
          const source = matches.find(s => s.source_lead_id) || matches[0];
          events.push({ company: source.company_id, source: source.source_ref, type: 'opt_out', ref: `${table}:${hit.token}`, at: hit[atColumn] });
        }
      }
    }
    const leadIds = batch.map(s => s.source_lead_id).filter(Boolean) as string[];
    if (leadIds.length) {
      const replies = await rows(db.from('adam_pipeline_replies').select('id,lead_id,category,received_at').in('lead_id', leadIds).order('received_at', { ascending: false }).limit(500));
      const bookings = await rows(db.from('adam_pipeline_bookings').select('id,lead_id,booked_at').in('lead_id', leadIds).order('booked_at', { ascending: false }).limit(500));
      for (const hit of replies) { const s = batch.find(s => s.source_lead_id === hit.lead_id)!; events.push({ company: s.company_id, source: s.source_ref, type: replyEvent(hit.category), ref: `reply:${hit.id}`, at: hit.received_at }); }
      for (const hit of bookings) { const s = batch.find(s => s.source_lead_id === hit.lead_id)!; events.push({ company: s.company_id, source: s.source_ref, type: 'meeting_booked', ref: `booking:${hit.id}`, at: hit.booked_at }); }
    }
  }
  const uniqueEvents = [...new Map(events.map(e => [e.ref, e])).values()];
  const handled = new Set<string>();
  for (const batch of chunks(uniqueEvents)) for (const receipt of await rows(db.from('sales_lead_event_receipts').select('event_ref').eq('workspace_id', scope.workspaceId).in('event_ref', batch.map(e => e.ref)))) handled.add(receipt.event_ref);
  const pendingEvents = uniqueEvents.filter(e => !handled.has(e.ref)).sort((a, b) => Number(b.type === 'opt_out' || b.type === 'negative_reply') - Number(a.type === 'opt_out' || a.type === 'negative_reply') || a.at.localeCompare(b.at));
  // Suppressions always run first. A bounded batch leaves unprocessed receipts available on the next run.
  for (const e of pendingEvents.slice(0, 100)) {
    const { error } = await db.rpc('record_sales_lead_event_service', { p_workspace: scope.workspaceId, p_actor: scope.userId, p_company: e.company, p_event: { type: e.type, ref: e.ref, sourceRef: e.source, occurredAt: e.at } });
    if (error) { if (/sales_lead_(access|owner_conflict|source_conflict)/.test(error.message)) { review++; continue; } throw error; }
    applied++;
  }
  return { connected: true, imported, events: applied, review, pendingEvents: Math.max(0, pendingEvents.length - 100) };
}
