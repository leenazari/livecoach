import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

const google = read("lib/google.ts");
const drive = read("lib/google-drive.ts");
const status = read("app/api/auth/google/status/route.ts");
const driveRoute = read(
  "app/api/crm/chat/files/[attachmentId]/drive/route.ts"
);
const chatPage = read("app/crm/chat/page.tsx");
const settings = read("app/settings/page.tsx");
const privacy = read("app/privacy/page.tsx");

assert.match(google, /GOOGLE_DRIVE_FILE_SCOPE/);
assert.match(google, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
assert.doesNotMatch(
  google,
  /https:\/\/www\.googleapis\.com\/auth\/drive["']/,
  "The Google connector must not request broad Drive access"
);
assert.match(status, /driveReconnectRequired/);
assert.match(status, /GOOGLE_DRIVE_FILE_SCOPE/);

assert.match(drive, /uploadType: "resumable"/);
assert.match(drive, /X-Upload-Content-Type/);
assert.match(drive, /X-Upload-Content-Length/);
assert.match(drive, /Content-Length/);
assert.match(drive, /session\.hostname !== "www\.googleapis\.com"/);
assert.match(drive, /livecoachWorkspaceId/);
assert.match(drive, /livecoachConversationId/);
assert.match(drive, /livecoachAttachmentId/);
assert.match(drive, /appProperties has/);
assert.match(drive, /LiveCoach CRM Files/);

assert.match(driveRoute, /requireRequestScope\(\)/);
assert.match(driveRoute, /scope\.workspaceId/);
assert.match(driveRoute, /requireChatMembership/);
assert.match(driveRoute, /getAccessToken\(false, scope\.userId\)/);
assert.match(driveRoute, /CHAT_ALLOWED_MIME_TYPES/);
assert.match(driveRoute, /CHAT_MAX_FILE_BYTES/);
assert.match(driveRoute, /findChatAttachmentInDrive/);
assert.match(driveRoute, /ensureLiveCoachDriveFolder/);
assert.match(driveRoute, /uploadChatAttachmentToDrive/);
assert.match(driveRoute, /\.from\(CHAT_FILE_BUCKET\)[\s\S]*\.download\(attachment\.storage_path\)/);
assert.match(driveRoute, /chat_attachment_saved_to_google_drive/);
assert.doesNotMatch(driveRoute, /accessToken[,:]\s*accessToken/);

assert.match(chatPage, /Save to Drive/);
assert.match(chatPage, /Open Drive/);
assert.match(chatPage, /\/api\/auth\/google\/start/);
assert.match(chatPage, /target="_blank"/);
assert.match(chatPage, /driveSaving\.current/);
assert.match(chatPage, /\/api\/crm\/chat\/files\/\$\{attachment\.id\}\/drive/);
assert.match(settings, /Grant Drive access/);
assert.match(settings, /copied only when you press Save to Drive/);
assert.match(privacy, /Google Drive storage is optional and user initiated/);
assert.match(privacy, /does not allow LiveCoach CRM to browse or manage[\s\S]*unrelated Drive files/);
assert.match(privacy, /separate copy controlled by the connected Google account/);

console.log("Google Drive chat storage checks passed");
