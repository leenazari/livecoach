export const LIVECOACH_ACCESS_TOKEN_HEADER =
  "x-livecoach-verified-access-token";
export const LIVECOACH_USER_ID_HEADER = "x-livecoach-verified-user-id";
export const LIVECOACH_WORKSPACE_ID_HEADER =
  "x-livecoach-verified-workspace-id";
export const LIVECOACH_WORKSPACE_ROLE_HEADER =
  "x-livecoach-verified-workspace-role";
export const LIVECOACH_WORKSPACE_STATUS_HEADER =
  "x-livecoach-verified-workspace-status";
export const LIVECOACH_SERVICE_REQUEST_HEADER =
  "x-livecoach-verified-service-request";

// These headers are internal request context. Middleware removes every
// client-supplied value before adding the verified account and membership.
export const LIVECOACH_INTERNAL_AUTH_HEADERS = [
  LIVECOACH_ACCESS_TOKEN_HEADER,
  LIVECOACH_USER_ID_HEADER,
  LIVECOACH_WORKSPACE_ID_HEADER,
  LIVECOACH_WORKSPACE_ROLE_HEADER,
  LIVECOACH_WORKSPACE_STATUS_HEADER,
  LIVECOACH_SERVICE_REQUEST_HEADER,
] as const;
