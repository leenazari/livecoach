import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export type ServiceRecordScope = {
  userId: string;
  workspaceId: string;
};

const storage = new AsyncLocalStorage<ServiceRecordScope>();

export function getServiceRecordScope(): ServiceRecordScope | null {
  return storage.getStore() || null;
}

export function runWithServiceRecordScope<T>(
  scope: ServiceRecordScope,
  work: () => T
): T {
  return storage.run(scope, work);
}
