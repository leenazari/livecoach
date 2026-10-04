import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabase';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'not authorised' }, { status: 401 });
  if (process.env.VERCEL_ENV === 'preview') return NextResponse.json({ ok: true, skipped: 'preview' });
  const { data, error } = await supabaseService.rpc('prune_expired_brain_audits_service');
  return error ? NextResponse.json({ error: 'Brain audit cleanup failed' }, { status: 503 }) : NextResponse.json({ ok: true, deleted: data });
}
