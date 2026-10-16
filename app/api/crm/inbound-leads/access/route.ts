import { inboundAccess, inboundResponse, inboundFailure } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET() { try { return inboundResponse((await inboundAccess()).access); } catch (error) { return inboundFailure(error); } }
