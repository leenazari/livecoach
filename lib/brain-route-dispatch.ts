import 'server-only';
import { NextRequest } from 'next/server';
import { delegatedRequestScope } from '@/lib/delegated-request-scope';
import { internalAppOrigin } from '@/lib/public-app-url';

type RouteModule = Record<string, unknown>;
type Handler = (request: NextRequest, context: { params: Record<string, string> }) => Promise<Response>;
type Route = { path: RegExp; param?: string; load: () => Promise<RouteModule> };
// Transport map only: each original route still enforces its existing role,
// RLS, assignment, provider-account, cost and suppression checks. No model can
// supply a module name, a host or an unlisted API endpoint to this dispatcher.
const routes: Route[] = [
  { path: /^\/api\/crm\/assistant$/, load: () => import('@/app/api/crm/assistant/route') },
  { path: /^\/api\/crm\/assistant\/execute$/, load: () => import('@/app/api/crm/assistant/execute/route') },
  { path: /^\/api\/crm\/assistant\/receipts$/, load: () => import('@/app/api/crm/assistant/receipts/route') },
  { path: /^\/api\/crm\/assistant\/executions\/([0-9a-f-]+)\/undo$/i, param: 'id', load: () => import('@/app/api/crm/assistant/executions/[id]/undo/route') },
  { path: /^\/api\/crm\/upcoming$/, load: () => import('@/app/api/crm/upcoming/route') },
  { path: /^\/api\/crm\/upcoming\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/upcoming/[id]/route') },
  { path: /^\/api\/crm\/upcoming\/([0-9a-f-]+)\/cancel$/i, param: 'id', load: () => import('@/app/api/crm/upcoming/[id]/cancel/route') },
  { path: /^\/api\/crm\/companies$/, load: () => import('@/app/api/crm/companies/route') },
  { path: /^\/api\/crm\/companies\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/companies/[id]/route') },
  { path: /^\/api\/crm\/companies\/([0-9a-f-]+)\/activity$/i, param: 'id', load: () => import('@/app/api/crm/companies/[id]/activity/route') },
  { path: /^\/api\/crm\/companies\/([0-9a-f-]+)\/pipeline$/i, param: 'id', load: () => import('@/app/api/crm/companies/[id]/pipeline/route') },
  { path: /^\/api\/crm\/companies\/([0-9a-f-]+)\/correct$/i, param: 'id', load: () => import('@/app/api/crm/companies/[id]/correct/route') },
  { path: /^\/api\/crm\/contacts$/, load: () => import('@/app/api/crm/contacts/route') },
  { path: /^\/api\/crm\/contacts\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/contacts/[id]/route') },
  { path: /^\/api\/crm\/documents$/, load: () => import('@/app/api/crm/documents/route') },
  { path: /^\/api\/crm\/tasks$/, load: () => import('@/app/api/crm/tasks/route') },
  { path: /^\/api\/crm\/tasks\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/tasks/[id]/route') },
  { path: /^\/api\/crm\/follow-ups\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/follow-ups/[id]/route') },
  { path: /^\/api\/crm\/opportunities\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/opportunities/[id]/route') },
  { path: /^\/api\/crm\/opportunity-clarifications\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/opportunity-clarifications/[id]/route') },
  { path: /^\/api\/crm\/outreach\/campaigns$/, load: () => import('@/app/api/crm/outreach/campaigns/route') },
  { path: /^\/api\/crm\/outreach\/campaigns\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/outreach/campaigns/[id]/route') },
  { path: /^\/api\/crm\/outreach\/queue$/, load: () => import('@/app/api/crm/outreach/queue/route') },
  { path: /^\/api\/crm\/assistant\/email$/, load: () => import('@/app/api/crm/assistant/email/route') },
  { path: /^\/api\/crm\/email-pull$/, load: () => import('@/app/api/crm/email-pull/route') },
  { path: /^\/api\/crm\/brain\/remember$/, load: () => import('@/app/api/crm/brain/remember/route') },
  { path: /^\/api\/crm\/brain\/assign-work$/, load: () => import('@/app/api/crm/brain/assign-work/route') },
  { path: /^\/api\/crm\/team\/sharing$/, load: () => import('@/app/api/crm/team/sharing/route') },
  { path: /^\/api\/crm\/outreach\/assign$/, load: () => import('@/app/api/crm/outreach/assign/route') },
  { path: /^\/api\/crm\/imports\/outreach\/stage$/, load: () => import('@/app/api/crm/imports/outreach/stage/route') },
  { path: /^\/api\/crm\/outreach\/([0-9a-f-]+)\/sendpilot$/i, param: 'id', load: () => import('@/app/api/crm/outreach/[id]/sendpilot/route') },
  { path: /^\/api\/crm\/sendpilot\/control$/, load: () => import('@/app/api/crm/sendpilot/control/route') },
  { path: /^\/api\/crm\/outreach\/([0-9a-f-]+)\/prepare$/i, param: 'id', load: () => import('@/app/api/crm/outreach/[id]/prepare/route') },
  { path: /^\/api\/crm\/outreach\/replies\/([0-9a-f-]+)\/draft$/i, param: 'id', load: () => import('@/app/api/crm/outreach/replies/[id]/draft/route') },
  { path: /^\/api\/crm\/outreach\/messages\/([0-9a-f-]+)$/i, param: 'id', load: () => import('@/app/api/crm/outreach/messages/[id]/route') },
  { path: /^\/api\/crm\/outreach\/messages\/([0-9a-f-]+)\/send$/i, param: 'id', load: () => import('@/app/api/crm/outreach/messages/[id]/send/route') },
  { path: /^\/api\/crm\/outreach\/messages\/([0-9a-f-]+)\/voice$/i, param: 'id', load: () => import('@/app/api/crm/outreach/messages/[id]/voice/route') },
  { path: /^\/api\/crm\/outreach\/messages\/([0-9a-f-]+)\/voice-script$/i, param: 'id', load: () => import('@/app/api/crm/outreach/messages/[id]/voice-script/route') },
  { path: /^\/api\/crm\/brain\/outreach-approve$/, load: () => import('@/app/api/crm/brain/outreach-approve/route') },
  { path: /^\/api\/crm\/brain\/outreach-voice$/, load: () => import('@/app/api/crm/brain/outreach-voice/route') },
  { path: /^\/api\/crm\/outreach\/([0-9a-f-]+)\/sequence-action$/i, param: 'id', load: () => import('@/app/api/crm/outreach/[id]/sequence-action/route') },
  { path: /^\/api\/crm\/outreach\/([0-9a-f-]+)\/follow-up$/i, param: 'id', load: () => import('@/app/api/crm/outreach/[id]/follow-up/route') },
  { path: /^\/api\/crm\/chat$/, load: () => import('@/app/api/crm/chat/route') },
  { path: /^\/api\/crm\/chat\/([0-9a-f-]+)\/messages$/i, param: 'conversationId', load: () => import('@/app/api/crm/chat/[conversationId]/messages/route') },
  { path: /^\/api\/crm\/brain\/share$/, load: () => import('@/app/api/crm/brain/share/route') },
  { path: /^\/api\/crm\/duplicates\/merge$/, load: () => import('@/app/api/crm/duplicates/merge/route') },
];

export async function dispatchDelegatedBrainRoute(endpoint: string, method: string, body: Record<string, unknown>, headers?: Record<string, string>): Promise<Response> {
  if (!delegatedRequestScope()) throw new Error('Verified Brain delegation is required');
  const route = routes.find(r => r.path.test(endpoint));
  if (!route || !['POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('This Brain route is not permitted');
  const module = await route.load();
  const handler = module[method] as Handler | undefined;
  if (typeof handler !== 'function') throw new Error('This Brain route method is not supported');
  const params = route.param ? { [route.param]: endpoint.match(route.path)![1] } : {};
  return handler(new NextRequest(new URL(endpoint, internalAppOrigin()), {
    method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), { params });
}
