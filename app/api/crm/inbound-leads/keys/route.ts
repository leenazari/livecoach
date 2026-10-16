import { NextRequest } from 'next/server';
import { z } from 'zod';
import { inboundKeyInput } from '@/lib/inbound-leads';
import { adminCommand, inboundFailure, inboundResponse, newInboundCredential, readInboundBody } from '@/lib/inbound-leads-server';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { try { const body = inboundKeyInput.parse(await readInboundBody(req)); const { token, tokenHash, tokenPrefix } = newInboundCredential(); const data = await adminCommand('create_key', { ...body, tokenHash, tokenPrefix }); return inboundResponse({ ...data, token }, 201); } catch (error) { return inboundFailure(error); } }
export async function DELETE(req: NextRequest) { try { const body = z.object({ keyId: z.uuid() }).strict().parse(await readInboundBody(req)); return inboundResponse(await adminCommand('revoke_key', body)); } catch (error) { return inboundFailure(error); } }
