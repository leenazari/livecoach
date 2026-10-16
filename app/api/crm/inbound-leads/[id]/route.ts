import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin, supabaseService } from '@/lib/supabase';
import { reviewerCommand } from '@/lib/inbound-leads';
import { inboundLead, inboundResponse, inboundFailure, readInboundBody, requireInboundReviewer } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try { const id = z.uuid().parse(params.id); const { scope, lead } = await inboundLead(id);
    const events = await supabaseAdmin.from('inbound_lead_events').select('id,event_type,occurred_at,received_at,details').eq('workspace_id', scope.workspaceId).eq('lead_id', id).order('occurred_at', { ascending: false }).order('id').limit(100);
    if (events.error) throw events.error; return inboundResponse({ lead, events: events.data || [] });
  } catch (error) { return inboundFailure(error); }
}
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try { const id = z.uuid().parse(params.id); const { scope } = await requireInboundReviewer(); const body = reviewerCommand.parse(await readInboundBody(req));
    const { data, error } = await supabaseService.rpc('inbound_review_command', { p_workspace_id: scope.workspaceId, p_actor_id: scope.userId, p_lead_id: id, p_payload: body });
    if (error) throw error; return inboundResponse(data);
  } catch (error) { return inboundFailure(error); }
}
