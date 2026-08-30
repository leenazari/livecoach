import "server-only";

const DRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string | null;
  webViewLink: string | null;
};

export class GoogleDriveError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "GoogleDriveError";
    this.status = status;
  }
}

const escapeDriveQueryValue = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const driveError = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => ({}));
  const message = String(payload?.error?.message || "");
  const reasons = [
    ...(Array.isArray(payload?.error?.errors)
      ? payload.error.errors.map((item: any) => item?.reason)
      : []),
    ...(Array.isArray(payload?.error?.details)
      ? payload.error.details.map((item: any) => item?.reason)
      : []),
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  const reasonText = reasons.join(" ");
  const lowerMessage = message.toLowerCase();

  if (
    response.status === 401 ||
    reasonText.includes("insufficient") ||
    lowerMessage.includes("insufficient authentication scopes")
  ) {
    return new GoogleDriveError(
      "Reconnect Google to grant LiveCoach permission to save files to Drive",
      428
    );
  }
  if (
    reasonText.includes("accessnotconfigured") ||
    reasonText.includes("service_disabled") ||
    lowerMessage.includes("drive api has not been used") ||
    lowerMessage.includes("drive api is disabled")
  ) {
    return new GoogleDriveError(
      "Google Drive API is not enabled for the LiveCoach Google project",
      503
    );
  }
  if (
    response.status === 429 ||
    reasonText.includes("ratelimit") ||
    reasonText.includes("userratelimit")
  ) {
    return new GoogleDriveError(
      "Google Drive is temporarily busy. Try saving this file again shortly",
      429
    );
  }
  return new GoogleDriveError(fallback, 502);
};

const driveFile = (value: any): GoogleDriveFile => ({
  id: String(value?.id || ""),
  name: String(value?.name || ""),
  mimeType: value?.mimeType ? String(value.mimeType) : null,
  webViewLink: value?.webViewLink ? String(value.webViewLink) : null,
});

async function findFirstDriveFile(accessToken: string, query: string) {
  const params = new URLSearchParams({
    q: query,
    spaces: "drive",
    pageSize: "10",
    fields: "files(id,name,mimeType,webViewLink)",
  });
  const response = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw await driveError(response, "Google Drive could not be searched");
  const payload = await response.json();
  const file = Array.isArray(payload?.files) ? payload.files[0] : null;
  return file ? driveFile(file) : null;
}

export async function findChatAttachmentInDrive(input: {
  accessToken: string;
  workspaceId: string;
  attachmentId: string;
}) {
  const workspaceId = escapeDriveQueryValue(input.workspaceId);
  const attachmentId = escapeDriveQueryValue(input.attachmentId);
  return findFirstDriveFile(
    input.accessToken,
    `trashed = false and appProperties has { key='livecoachWorkspaceId' and value='${workspaceId}' } and appProperties has { key='livecoachAttachmentId' and value='${attachmentId}' }`
  );
}

async function createDriveFolder(input: {
  accessToken: string;
  workspaceId: string;
}) {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,webViewLink",
  });
  const response = await fetch(`${DRIVE_FILES_API}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "LiveCoach CRM Files",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      appProperties: {
        livecoachKind: "crmFilesRoot",
        livecoachWorkspaceId: input.workspaceId,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw await driveError(response, "The LiveCoach Drive folder could not be created");
  return driveFile(await response.json());
}

export async function ensureLiveCoachDriveFolder(input: {
  accessToken: string;
  workspaceId: string;
}) {
  const workspaceId = escapeDriveQueryValue(input.workspaceId);
  const existing = await findFirstDriveFile(
    input.accessToken,
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false and appProperties has { key='livecoachKind' and value='crmFilesRoot' } and appProperties has { key='livecoachWorkspaceId' and value='${workspaceId}' }`
  );
  return existing || createDriveFolder(input);
}

export async function uploadChatAttachmentToDrive(input: {
  accessToken: string;
  workspaceId: string;
  conversationId: string;
  attachmentId: string;
  conversationLabel: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  content: ArrayBuffer;
}) {
  const params = new URLSearchParams({
    uploadType: "resumable",
    fields: "id,name,mimeType,webViewLink",
  });
  const metadata = JSON.stringify({
    name: input.fileName,
    mimeType: input.mimeType,
    parents: [input.folderId],
    description: `Saved from LiveCoach Team Chat. ${input.conversationLabel}`,
    appProperties: {
      livecoachWorkspaceId: input.workspaceId,
      livecoachConversationId: input.conversationId,
      livecoachAttachmentId: input.attachmentId,
    },
  });
  const initiate = await fetch(`${DRIVE_UPLOAD_API}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "Content-Length": String(Buffer.byteLength(metadata)),
      "X-Upload-Content-Type": input.mimeType,
      "X-Upload-Content-Length": String(input.content.byteLength),
    },
    body: metadata,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!initiate.ok) {
    throw await driveError(initiate, "Google Drive could not prepare the file upload");
  }
  const sessionUrl = initiate.headers.get("location");
  if (!sessionUrl) {
    throw new GoogleDriveError("Google Drive did not confirm the file upload session");
  }
  const session = new URL(sessionUrl);
  if (session.protocol !== "https:" || session.hostname !== "www.googleapis.com") {
    throw new GoogleDriveError("Google Drive returned an invalid upload destination");
  }
  const upload = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": input.mimeType,
      "Content-Length": String(input.content.byteLength),
    },
    body: input.content,
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  if (!upload.ok) throw await driveError(upload, "The file could not be saved to Google Drive");
  const saved = driveFile(await upload.json());
  if (!saved.id || !saved.webViewLink) {
    throw new GoogleDriveError("Google Drive did not confirm the saved file");
  }
  return saved;
}
