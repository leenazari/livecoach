import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestScope } from '@/lib/request-scope';

// Server-only context for an already verified MCP principal. This is never
// populated from request headers, a tool argument, a service token or a cookie.
const storage = new AsyncLocalStorage<Readonly<RequestScope>>();
export const delegatedRequestScope = () => storage.getStore() || null;
export function runWithDelegatedRequestScope<T>(scope: RequestScope, work: () => T): T {
  if (scope.status !== 'active' || !scope.accessToken || !['owner', 'manager', 'sales'].includes(scope.role)) {
    throw new Error('An active verified user is required for Brain delegation');
  }
  return storage.run(Object.freeze({ ...scope }), work);
}
