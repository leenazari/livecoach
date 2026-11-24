import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { salesLeadHeaders, salesLeadScope } from '@/lib/sales-lead-service';
import { loadAssignedClientAccess } from '@/lib/assigned-client-access';
import { crmBlockerPayload } from '@/lib/crm-blocker';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = 'id,company_id,workspace_id,owner_id,kind,title,content,created_at';

// An explicit log-only path through the existing activity endpoint. It writes
// the canonical source note, never a second timeline, draft or deal update.
// The client-chosen UUID makes an interrupted retry resolve the same note.
export async function saveManualClientNote(companyId: string, body: any) {
  try {
    const scope = await salesLeadScope();
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!uuid.test(companyId) || !uuid.test(String(body.requestId || '')) || !['note', 'phone'].includes(body.channel) || !content || content.length > 4000 || body.autoApply === true || body.completeTaskId) {
      return NextResponse.json(crmBlockerPayload({ code: 'manual_note_invalid', title: 'Check the note before saving', reason: 'A note needs text, a valid client and a note or phone-call type', nextAction: 'Keep your text, reopen the note form and check the selected company' }), { status: 400, headers: salesLeadHeaders });
    }
    const access = await loadAssignedClientAccess(companyId, scope);
    if (!access) throw new Error('sales_lead_access');
    const title = body.channel === 'phone' ? 'Phone call' : 'General note';
    const existing = () => supabaseAdmin.from('client_context').select(fields)
      .eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('company_id', companyId).eq('id', body.requestId).maybeSingle();
    const prior = await existing();
    if (prior.error) throw prior.error;
    let item = prior.data;
    if (!item) {
      const saved = await supabaseAdmin.from('client_context').insert({ id: body.requestId, workspace_id: scope.workspaceId, owner_id: scope.userId, company_id: companyId, kind: 'note', title, content }).select(fields).single();
      if (saved.error && saved.error.code !== '23505') throw saved.error;
      if (saved.error) {
        const raced = await existing();
        if (raced.error) throw raced.error;
        item = raced.data;
      } else item = saved.data;
    }
    if (!item || item.workspace_id !== scope.workspaceId || item.owner_id !== scope.userId || item.company_id !== companyId || item.kind !== 'note' || item.title !== title || item.content !== content) {
      return NextResponse.json(crmBlockerPayload({ code: 'manual_note_conflict', title: 'This note needs checking', reason: 'The same save reference has already been used for different content', nextAction: 'Check your recent notes before starting a new note. Your current text is still in the form' }), { status: 409, headers: salesLeadHeaders });
    }
    return NextResponse.json({ item: { id: item.id, company_id: companyId, title: item.title, content: item.content, created_at: item.created_at }, intelligence: null, alreadyExists: !!prior.data }, { headers: salesLeadHeaders });
  } catch (error) {
    const denied = /sales_lead_access|verified workspace/.test(String((error as Error)?.message));
    console.error('manual_client_note_failed', { code: denied ? 'access_denied' : 'save_unconfirmed' });
    return NextResponse.json(crmBlockerPayload({ code: denied ? 'manual_note_access_denied' : 'manual_note_save_unconfirmed', title: denied ? 'Note access has changed' : 'Note save could not be confirmed', reason: denied ? 'Your active account cannot add a note to this client' : 'The connection did not confirm whether the note was stored', nextAction: denied ? 'Keep your text and ask Lee to check your membership and client assignment' : 'Check recent notes first. If needed, use the same unchanged form to retry safely', responsible: denied ? 'owner' : 'system' }), { status: denied ? 403 : 503, headers: salesLeadHeaders });
  }
}
