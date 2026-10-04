import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { marketingDirectory, marketingScope } from '@/lib/marketing-server';
import { MARKETING_CHANNELS, MARKETING_STAGES, MARKETING_LESSONS, OWN_APPROACH, UUID, marketingDate, marketingSpend, marketingText, type MarketingSection } from '@/lib/marketing';
import { upsertTasks } from '@/lib/tasks';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const fail = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : 'Marketing could not be updated' }, { status: 400, headers });
export async function GET() {
  try {
    const scope = await marketingScope();
    const [campaigns, leads, feedback, tasks, connections, members] = await Promise.all([
      supabaseAdmin.from('marketing_campaigns').select('id,name,audience,offer,channel,status,spend_gbp,success_measure,review_on').eq('workspace_id', scope.workspaceId).order('created_at', { ascending: false }).limit(1001),
      supabaseAdmin.from('marketing_leads').select('id,campaign_id,company_name,contact_name,contact_email,company_size,notes,assigned_to_user_id,created_at').eq('workspace_id', scope.workspaceId).order('created_at', { ascending: false }).limit(1001),
      supabaseAdmin.from('marketing_lead_feedback').select('lead_id,user_id,stage,reason').eq('workspace_id', scope.workspaceId).limit(1001),
      supabaseAdmin.from('tasks').select('id,text,status,due_at,payload').eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('source', 'marketing').eq('status', 'open').order('due_at', { ascending: true }).limit(100),
      scope.canManage ? supabaseAdmin.from('marketing_connections').select('provider,property_id,snapshot,synced_at').eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId) : Promise.resolve({ data: [], error: null }),
      marketingDirectory(scope.workspaceId)
    ]);
    for (const result of [campaigns, leads, feedback, tasks, connections]) if (result.error) throw result.error;
    return NextResponse.json({ canManage: scope.canManage, userId: scope.userId, campaigns: campaigns.data || [], leads: leads.data || [], feedback: feedback.data || [], tasks: tasks.data || [], connections: connections.data || [], members, fetchedAt: new Date().toISOString(), limited: [campaigns, leads, feedback].some(r => (r.data?.length || 0) > 1000) }, { headers });
  } catch (error) { return fail(error); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const scope = await marketingScope(body.action !== 'feedback');
    if (body.action === 'campaign') {
      const channel = String(body.channel || '');
      if (!(MARKETING_CHANNELS as readonly string[]).includes(channel)) throw new Error('Choose a campaign channel');
      const values = { name: marketingText(body.name, 120, true), audience: marketingText(body.audience, 1000, true), offer: marketingText(body.offer, 1000, true), channel, spend_gbp: marketingSpend(body.spend), success_measure: marketingText(body.successMeasure, 500, true), review_on: marketingDate(body.reviewOn), updated_at: new Date().toISOString() };
      const id = String(body.id || '');
      if (id && !UUID.test(id)) throw new Error('Choose a valid campaign');
      const query = id ? supabaseAdmin.from('marketing_campaigns').update(values).eq('workspace_id', scope.workspaceId).eq('id', id) : supabaseAdmin.from('marketing_campaigns').insert({ ...values, workspace_id: scope.workspaceId, owner_id: scope.userId });
      const { data, error } = await query.select('id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id }, { headers });
    }
    if (body.action === 'lead') {
      if (!UUID.test(String(body.campaignId || ''))) throw new Error('Choose the campaign that generated the lead');
      const assigned = String(body.assignedTo || '');
      if (assigned && !(await marketingDirectory(scope.workspaceId)).some(m => m.userId === assigned)) throw new Error('Choose an active salesperson in this workspace');
      const email = marketingText(body.contactEmail, 254);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid contact email');
      const { data, error } = await supabaseAdmin.from('marketing_leads').insert({ workspace_id: scope.workspaceId, owner_id: scope.userId, campaign_id: body.campaignId, company_name: marketingText(body.companyName, 160, true), contact_name: marketingText(body.contactName, 160), contact_email: email, company_size: marketingText(body.companySize, 120), notes: marketingText(body.notes, 2000, true), assigned_to_user_id: assigned || null }).select('id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id }, { headers });
    }
    if (body.action === 'feedback') {
      const leadId = String(body.leadId || '');
      const stage = String(body.stage || '');
      if (!UUID.test(leadId) || !(MARKETING_STAGES as readonly string[]).includes(stage)) throw new Error('Choose a valid lead and outcome');
      const reason = marketingText(body.reason, 1000, true);
      const { data: lead, error: leadError } = await supabaseAdmin.from('marketing_leads').select('id').eq('workspace_id', scope.workspaceId).eq('id', leadId).eq('assigned_to_user_id', scope.userId).maybeSingle();
      if (leadError) throw leadError;
      if (!lead) throw new Error('Only the assigned salesperson can record this lead’s outcome');
      const { data, error } = await supabaseAdmin.from('marketing_lead_feedback').upsert({ lead_id: leadId, workspace_id: scope.workspaceId, user_id: scope.userId, stage, reason, updated_at: new Date().toISOString() }, { onConflict: 'lead_id' }).select('lead_id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.lead_id }, { headers });
    }
    if (body.action === 'assign') {
      const id = String(body.leadId || '');
      const assigned = String(body.assignedTo || '');
      if (!UUID.test(id) || !(await marketingDirectory(scope.workspaceId)).some(m => m.userId === assigned)) throw new Error('Choose a lead and active salesperson');
      const { data: feedback, error: feedbackError } = await supabaseAdmin.from('marketing_lead_feedback').select('lead_id').eq('workspace_id', scope.workspaceId).eq('lead_id', id).maybeSingle();
      if (feedbackError) throw feedbackError;
      if (feedback) throw new Error('This lead already has sales feedback. Keep the recorded owner and arrange cover through the team.');
      const { data, error } = await supabaseAdmin.from('marketing_leads').update({ assigned_to_user_id: assigned }).eq('workspace_id', scope.workspaceId).eq('id', id).select('id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id }, { headers });
    }
    if (body.action === 'plan') {
      const section = String(body.section || '') as MarketingSection;
      const lesson = MARKETING_LESSONS[section];
      if (!lesson) throw new Error('Choose a coaching section');
      const approach = [...lesson.approaches, OWN_APPROACH].find(a => a.id === body.approach);
      if (!approach) throw new Error('Choose an approach');
      const own = marketingText(body.ownApproach, 600, approach.id === 'own');
      const measure = marketingText(body.measure, 500, true);
      const dueOn = marketingDate(body.dueOn);
      const requestId = String(body.requestId || '');
      if (!UUID.test(requestId)) throw new Error('Refresh the plan and try again');
      const text = `Marketing: ${approach.id === 'own' ? own : approach.name}. Success: ${measure}`.slice(0, 500);
      const sourceRef = `marketing_plan:${requestId}`;
      await upsertTasks(null, [{ text, kind: 'manual', source: 'marketing', sourceRef, fingerprintKey: sourceRef, distinctSourceEvent: true, pinned: true, dueAt: `${dueOn}T12:00:00Z`, payload: { section, approach: approach.id, ownApproach: own, measure, dueOn, steps: approach.steps } }]);
      const { data, error } = await supabaseAdmin.from('tasks').select('id').eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('source_ref', sourceRef).single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id }, { headers });
    }
    throw new Error('Choose a valid marketing action');
  } catch (error) { return fail(error); }
}
