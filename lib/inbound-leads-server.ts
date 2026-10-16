import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRequestScope } from '@/lib/request-scope';
import { supabaseAdmin, supabaseService } from '@/lib/supabase';
import { contactPermissions, type InboundAccess, type InboundLead, type InboundMember } from '@/lib/inbound-leads';

export const INBOUND_FIELDS = 'id,company_name,contact_name,contact_email,contact_phone,business_type,company_size,need,source,source_lead_id,source_details,consent,qualification,status,version,review_note,duplicate_of,assigned_to_user_id,marketing_lead_id,created_at,updated_at,human_takeover,contact_stopped,journey_completed';
export const noStore = { 'Cache-Control': 'private, no-store' };
export class InboundError extends Error { constructor(public status: number, message: string) { super(message); } }
export function inboundResponse(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: noStore }); }
export function inboundFailure(error: unknown) {
  if (error instanceof z.ZodError) return inboundResponse({ error: error.issues[0]?.message || 'Check the supplied fields' }, 400);
  if (error instanceof InboundError) return inboundResponse({ error: error.message }, error.status);
  const message = String((error as { message?: string })?.message || '');
  const codes: Record<string, [number, string]> = {
    inbound_auth: [401, 'The integration credential is invalid, expired or revoked'], inbound_scope: [403, 'This credential does not permit that operation'],
    inbound_disabled: [503, 'Inbound intake is not enabled'], inbound_forbidden: [403, 'New leads access is not permitted'], inbound_not_found: [404, 'Lead or credential not found'],
    inbound_conflict: [409, 'This source or request ID was already used with different data'], inbound_stale: [409, 'This lead changed. Refresh before saving'],
    inbound_closed: [409, 'This lead has been handed over, stopped or closed'], inbound_not_ready: [409, 'Mark the lead ready and add a handover note first'],
    inbound_invalid_sales: [400, 'Choose an approved active salesperson'], inbound_invalid_reviewer: [400, 'Choose an active marketing reviewer'],
    inbound_invalid_expiry: [400, 'Choose an expiry within the next year'], inbound_rate: [429, 'Integration rate limit reached. Retry in one minute'],
    inbound_invalid_time: [400, 'Event time cannot be in the future'], inbound_invalid_action: [400, 'Choose a valid action'],
  };
  for (const [code, [status, text]] of Object.entries(codes)) if (message.includes(code)) return inboundResponse({ error: text, code }, status);
  console.error('Inbound operation failed', (error as { code?: string })?.code || 'unknown');
  return inboundResponse({ error: 'The operation could not be confirmed. Refresh or retry with the same request ID' }, 500);
}
export async function readInboundBody(req: NextRequest): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InboundError(415, 'Send application/json');
  const max = 65536;
  if (Number(req.headers.get('content-length') || 0) > max) throw new InboundError(413, 'Request exceeds 64 KB');
  const reader = req.body?.getReader();
  if (!reader) throw new InboundError(400, 'A JSON body is required');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new InboundError(413, 'Request exceeds 64 KB'); } chunks.push(value); }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new InboundError(400, 'Send valid JSON'); }
  } finally { reader.releaseLock(); }
}
export async function inboundAccess() {
  const scope = requireRequestScope();
  const member = await supabaseService.from('workspace_members').select('role,status').eq('workspace_id', scope.workspaceId).eq('user_id', scope.userId).maybeSingle();
  if (member.error) throw member.error;
  if (!member.data || member.data.status !== 'active') throw new InboundError(403, 'Active workspace access is required');
  const canConfigure = member.data.role === 'owner';
  const settings = await supabaseService.from('inbound_lead_settings').select('enabled,reviewer_user_id,sales_user_ids').eq('workspace_id', scope.workspaceId).maybeSingle();
  if (settings.error && !['42P01', 'PGRST205'].includes(settings.error.code)) throw settings.error;
  const schemaReady = !settings.error;
  const enabled = settings.data?.enabled === true;
  const canReview = canConfigure || (enabled && settings.data?.reviewer_user_id === scope.userId);
  const access: InboundAccess = { canReview, canConfigure, enabled, schemaReady };
  return { scope, settings: settings.data, access };
}
export async function requireInboundReviewer() {
  const ctx = await inboundAccess();
  if (!ctx.access.canReview) throw new InboundError(403, 'Only the owner and enabled inbound reviewer can open New leads');
  if (!ctx.access.schemaReady) throw new InboundError(503, 'The New leads database migration has not been installed');
  return ctx;
}
export async function requireInboundOwner() {
  const ctx = await inboundAccess();
  if (!ctx.access.canConfigure) throw new InboundError(403, 'Only the workspace owner can configure inbound access');
  if (!ctx.access.schemaReady) throw new InboundError(503, 'The New leads database migration has not been installed');
  return ctx;
}
export async function inboundSales(workspaceId: string, ids: string[]): Promise<InboundMember[]> {
  if (!ids.length) return [];
  const members = await supabaseService.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('status', 'active').eq('role', 'sales').eq('department', 'sales').in('user_id', ids);
  if (members.error) throw members.error;
  const users = (members.data || []).map(m => m.user_id);
  if (!users.length) return [];
  const profiles = await supabaseService.from('profiles').select('user_id,display_name').in('user_id', users);
  if (profiles.error) throw profiles.error;
  return (profiles.data || []).map(p => ({ userId: p.user_id, name: String(p.display_name || 'Salesperson') }));
}
export async function integrationCommand(req: NextRequest, action: 'create' | 'read' | 'update' | 'event', payload: unknown, leadId: string | null = null) {
  // This route never inherits browser cookies, internal headers or a cron identity.
  const match = /^Bearer (lci_[0-9a-f]{64})$/.exec(req.headers.get('authorization') || '');
  if (!match) throw new InboundError(401, 'A scoped integration bearer credential is required');
  const tokenHash = createHash('sha256').update(match[1]).digest('hex');
  const { data, error } = await supabaseService.rpc('inbound_integration_command', { p_key_hash: tokenHash, p_action: action, p_lead_id: leadId, p_payload: payload });
  if (error) throw error;
  if (action === 'read') return { lead: data, contactAllowed: contactPermissions(data as InboundLead) };
  return data;
}
export async function adminCommand(action: string, payload: unknown) {
  const { scope } = await requireInboundOwner();
  const { data, error } = await supabaseService.rpc('inbound_admin_command', { p_workspace_id: scope.workspaceId, p_actor_id: scope.userId, p_action: action, p_payload: payload });
  if (error) throw error; return data;
}
export function newInboundCredential() {
  const token = `lci_${randomBytes(32).toString('hex')}`;
  return { token, tokenHash: createHash('sha256').update(token).digest('hex'), tokenPrefix: token.slice(0, 12) };
}
export async function inboundLead(id: string) {
  const { scope } = await requireInboundReviewer();
  const { data, error } = await supabaseAdmin.from('inbound_leads').select(INBOUND_FIELDS).eq('workspace_id', scope.workspaceId).eq('id', id).maybeSingle();
  if (error) throw error; if (!data) throw new InboundError(404, 'Lead not found');
  return { scope, lead: data as InboundLead };
}
