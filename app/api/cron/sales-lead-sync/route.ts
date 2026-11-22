import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseService } from '@/lib/supabase';
import { syncSalesLeadFeed } from '@/lib/sales-lead-sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : '';
  const actual = req.headers.get('authorization') || '';
  if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { data, error } = await supabaseService.from('sales_lead_connections').select('workspace_id,owner_id').eq('source', 'adam').eq('enabled', true);
    if (error) throw error;
    const results = [];
    for (const c of data || []) results.push(await syncSalesLeadFeed({ workspaceId: c.workspace_id, userId: c.owner_id }));
    return NextResponse.json({ ok: true, results });
  } catch (e) { console.error('sales_lead_sync_failed', (e as any)?.code || 'unknown'); return NextResponse.json({ error: 'Lead sync was not confirmed. Stored receipts will be checked on the next run.' }, { status: 503 }); }
}
