import { NextRequest } from 'next/server';
import { inboundEvent } from '@/lib/inbound-leads';
import { integrationCommand, inboundFailure, inboundResponse, readInboundBody } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { try { const body = inboundEvent.parse(await readInboundBody(req)); return inboundResponse(await integrationCommand(req, 'event', body, body.leadId)); } catch (error) { return inboundFailure(error); } }
