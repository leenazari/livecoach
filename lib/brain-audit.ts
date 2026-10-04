import 'server-only';
import type { BrainScope } from '@/lib/brain-control';
import { delegatedRequestScope } from '@/lib/delegated-request-scope';
import { supabaseService } from '@/lib/supabase';

type AuditEvent = 'conversation_requested' | 'conversation_completed' | 'conversation_failed' | 'action_requested' | 'action_completed' | 'action_failed' | 'action_denied' | 'action_undone' | 'connector_failed';
const secretKey = /^(?:authorization|cookie|password|token|secret|client_?secret|access_?token|refresh_?token|execution_?token|api_?key|service_?role_?key|signing_?secret)$/i;
function auditValue(value: unknown, path: string, truncated: string[], depth = 0): unknown {
  if (depth > 12) { truncated.push(path); return '[depth limited]'; }
  if (typeof value === 'string') { if (value.length > 64000) truncated.push(path); return value.slice(0, 64000); }
  if (Array.isArray(value)) { if (value.length > 100) truncated.push(path); return value.slice(0, 100).map((item, i) => auditValue(item, `${path}.${i}`, truncated, depth + 1)); }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[redacted]' : auditValue(item, `${path}.${key}`, truncated, depth + 1)]));
  return value ?? null;
}
export async function logBrainAudit(scope: BrainScope, event: {
  source?: 'livecoach' | 'chatgpt'; eventType: AuditEvent; correlationId: string; status: 'started' | 'completed' | 'failed' | 'denied'; request?: Record<string, unknown>; response?: Record<string, unknown>; error?: string;
}) {
  if (scope.status !== 'active') throw new Error('Active user context is required for Brain auditing');
  const truncated: string[] = [];
  const request = auditValue(event.request || {}, 'request', truncated);
  const response = auditValue(event.response || {}, 'response', truncated);
  const { error } = await supabaseService.from('brain_audit_logs').insert({
    workspace_id: scope.workspaceId, actor_user_id: scope.userId, actor_role: scope.role,
    source: event.source || (delegatedRequestScope() ? 'chatgpt' : 'livecoach'), event_type: event.eventType,
    correlation_id: event.correlationId, status: event.status, request_payload: request,
    response_payload: response, error: event.error?.slice(0, 2000) || null, truncations: truncated,
  });
  if (error) throw error;
}
