import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceOwner } from '@/lib/request-scope';
import { supabaseAdmin, supabaseService } from '@/lib/supabase';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(request: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const actor = request.nextUrl.searchParams.get('actor');
    const cursor = request.nextUrl.searchParams.get('cursor');
    if (actor && !uuid.test(actor)) return NextResponse.json({ error: 'Invalid account filter' }, { status: 400 });
    let q = supabaseAdmin.from('brain_audit_logs')
      .select('id,actor_user_id,actor_role,source,event_type,correlation_id,status,request_payload,response_payload,error,truncations,created_at,expires_at')
      .eq('workspace_id', scope.workspaceId).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(26);
    if (actor) q = q.eq('actor_user_id', actor);
    if (cursor) {
      const [time, id, extra] = cursor.split('|');
      if (extra || !uuid.test(id || '') || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(time || '') || !Number.isFinite(Date.parse(time))) return NextResponse.json({ error: 'Invalid audit cursor' }, { status: 400 });
      q = q.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`);
    }
    const { data, error } = await q; if (error) throw error;
    const rows = data || [], logs = rows.slice(0, 25);
    const last = logs[logs.length - 1];
    const { data: members, error: memberError } = await supabaseService.from('workspace_members').select('user_id').eq('workspace_id', scope.workspaceId);
    if (memberError) throw memberError;
    const ids = [...new Set([...(members || []).map((member: any) => member.user_id), ...logs.map((row: any) => row.actor_user_id)])];
    const profiles = ids.length ? await supabaseService.from('profiles').select('user_id,display_name,email').in('user_id', ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    return NextResponse.json({ logs, users: profiles.data || [], nextCursor: rows.length > 25 && last ? `${last.created_at}|${last.id}` : null, retentionDays: 30 }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Brain audit unavailable' }, { status: /owner access/i.test(String(error)) ? 403 : 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
