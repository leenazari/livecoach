export const CHAT_FILE_BUCKET = "crm-chat-files";
export const CHAT_MAX_FILE_BYTES = 20 * 1024 * 1024;

export const CHAT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
