import { NextRequest } from 'next/server';
import { inboundCreate } from '@/lib/inbound-leads';
import { integrationCommand, inboundFailure, inboundResponse, readInboundBody } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { try { const body = inboundCreate.parse(await readInboundBody(req)); const result = await integrationCommand(req, 'create', body); return inboundResponse(result, result.created ? 201 : 200); } catch (error) { return inboundFailure(error); } }
