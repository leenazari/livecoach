import { NextRequest, NextResponse } from 'next/server';
import { marketingScope } from '@/lib/marketing-server';
import { supabaseAdmin } from '@/lib/supabase';
import { getAccessToken, googleHasScope, GOOGLE_ANALYTICS_READ_SCOPE } from '@/lib/google';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(req: NextRequest) {
  try {
    const scope = await marketingScope(true);
    const body = await req.json();
    const propertyId = String(body.propertyId || '').trim();
    if (!/^[0-9]{1,20}$/.test(propertyId)) throw new Error('Enter the numeric GA4 property ID');
    if (!(await googleHasScope(GOOGLE_ANALYTICS_READ_SCOPE, scope.userId))) throw new Error('Connect Google with Analytics access, using an account that can view this property');
    const token = await getAccessToken(false, scope.userId);
    if (!token) throw new Error('Connect your Google account first');
    const { data: previous, error: previousError } = await supabaseAdmin.from('marketing_connections').select('synced_at,property_id,snapshot').eq('workspace_id', scope.workspaceId).eq('owner_id', scope.userId).eq('provider', 'ga4').maybeSingle();
    if (previousError) throw previousError;
    if (previous?.property_id === propertyId && previous.synced_at && Date.now() - Date.parse(previous.synced_at) < 5 * 60_000) return NextResponse.json({ ok: true, cached: true }, { headers });
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ dateRanges: [{ startDate: '30daysAgo', endDate: 'yesterday' }], metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'keyEvents' }] }), cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(response.status === 403 ? 'Google Analytics denied access. Check the property permissions and that the Analytics Data API is enabled for the connected Google app.' : 'Google Analytics could not load. The last successful snapshot has been kept.');
    const report = await response.json();
    const metric = (index: number) => Number(report.rows?.[0]?.metricValues?.[index]?.value || 0);
    const snapshot = { users: metric(0), sessions: metric(1), keyEvents: metric(2), period: 'Previous 30 complete days · GA4 property timezone' };
    const { data, error } = await supabaseAdmin.from('marketing_connections').upsert({ workspace_id: scope.workspaceId, owner_id: scope.userId, provider: 'ga4', property_id: propertyId, snapshot, synced_at: new Date().toISOString() }, { onConflict: 'workspace_id,owner_id,provider' }).select('provider').single();
    if (error) throw error;
    return NextResponse.json({ ok: true, provider: data.provider }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Analytics could not load' }, { status: 400, headers }); }
}
