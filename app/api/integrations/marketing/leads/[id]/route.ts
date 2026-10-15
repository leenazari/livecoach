import { NextRequest } from 'next/server';
import { z } from 'zod';
import { inboundUpdate } from '@/lib/inbound-leads';
import { integrationCommand, inboundFailure, inboundResponse, readInboundBody } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest, { params }: { params: { id: string } }) { try { return inboundResponse(await integrationCommand(req, 'read', {}, z.uuid().parse(params.id))); } catch (error) { return inboundFailure(error); } }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) { try { const body = inboundUpdate.parse(await readInboundBody(req)); return inboundResponse(await integrationCommand(req, 'update', body, z.uuid().parse(params.id))); } catch (error) { return inboundFailure(error); } }
