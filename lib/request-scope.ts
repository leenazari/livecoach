import "server-only";

import { headers } from "next/headers";
import {
  LIVECOACH_ACCESS_TOKEN_HEADER,
  LIVECOACH_SERVICE_REQUEST_HEADER,
  LIVECOACH_USER_ID_HEADER,
  LIVECOACH_WORKSPACE_ID_HEADER,
  LIVECOACH_WORKSPACE_ROLE_HEADER,
  LIVECOACH_WORKSPACE_STATUS_HEADER,
} from "@/lib/internal-auth-headers";

export type WorkspaceRole = "owner" | "manager" | "sales";
export type WorkspaceMembershipStatus =
  | "active"
  | "onboarding"
  | "suspended"
  | "removed";

export type RequestScope = {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  status: WorkspaceMembershipStatus;
  accessToken: string;
};

export type VerifiedUser = {
  userId: string;
  accessToken: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only middleware may create these headers. It first removes any values sent
// by the browser, validates the Supabase user and active workspace membership,
// then forwards the verified context to the Node route handler.
export function getRequestScope(): RequestScope | null {
  try {
    const requestHeaders = headers();
    const userId = requestHeaders.get(LIVECOACH_USER_ID_HEADER) || "";
    const workspaceId =
      requestHeaders.get(LIVECOACH_WORKSPACE_ID_HEADER) || "";
    const role = requestHeaders.get(LIVECOACH_WORKSPACE_ROLE_HEADER) || "";
    const status =
      requestHeaders.get(LIVECOACH_WORKSPACE_STATUS_HEADER) || "";
    const accessToken =
      requestHeaders.get(LIVECOACH_ACCESS_TOKEN_HEADER) || "";
    if (!UUID.test(userId) || !UUID.test(workspaceId) || !accessToken) {
      return null;
    }
    if (!(["owner", "manager", "sales"] as string[]).includes(role)) {
      return null;
    }
    if (!("active onboarding suspended removed".split(" ")).includes(status)) {
      return null;
    }
    return {
      userId,
      workspaceId,
      role: role as WorkspaceRole,
      status: status as WorkspaceMembershipStatus,
      accessToken,
    };
  } catch {
    // Build-time code and authenticated server-to-server jobs do not have a
    // browser request context. They must use an explicitly scoped service path.
    return null;
  }
}

export function getVerifiedUser(): VerifiedUser | null {
  try {
    const requestHeaders = headers();
    const userId = requestHeaders.get(LIVECOACH_USER_ID_HEADER) || "";
    const accessToken =
      requestHeaders.get(LIVECOACH_ACCESS_TOKEN_HEADER) || "";
    if (!UUID.test(userId) || !accessToken) return null;
    return { userId, accessToken };
  } catch {
    return null;
  }
}

export function isVerifiedServiceRequest(): boolean {
  try {
    return headers().get(LIVECOACH_SERVICE_REQUEST_HEADER) === "cron";
  } catch {
    return false;
  }
}

export function requireRequestScope(): RequestScope {
  const scope = getRequestScope();
  if (!scope) throw new Error("verified workspace access is required");
  return scope;
}

export function requireWorkspaceManager(): RequestScope {
  const scope = requireRequestScope();
  if (scope.role !== "owner" && scope.role !== "manager") {
    throw new Error("workspace owner or manager access is required");
  }
  return scope;
}

export function requireWorkspaceOwner(): RequestScope {
  const scope = requireRequestScope();
  if (scope.role !== "owner" || scope.status !== "active") {
    throw new Error("workspace owner access is required");
  }
  return scope;
}
