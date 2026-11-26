import { randomUUID } from "node:crypto";
export type MailAttachment = { name: string; content: Buffer; mimeType: "application/pdf" };

export function addMimeAttachments(raw: string, attachments: MailAttachment[] = []): string {
  if (!attachments.length) return raw;
  if (attachments.length > 3 || attachments.reduce((n, a) => n + a.content.length, 0) > 16 * 1024 * 1024)
    throw new Error("Email attachments exceed the 16 MB limit");
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) throw new Error("Invalid email content");
  const headers = raw.slice(0, split);
  const contentType = headers.match(/^Content-Type: (.+)$/m)?.[1]?.trim();
  if (!contentType) throw new Error("Invalid email content type");
  const boundary = `lc_files_${randomUUID()}`;
  const parts = attachments.map(attachment => {
    if (attachment.mimeType !== "application/pdf" || attachment.content.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Only approved PDF attachments are supported");
    const filename = attachment.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "brochure.pdf";
    return [`--${boundary}`, "Content-Type: application/pdf", "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`, "",
      attachment.content.toString("base64").match(/.{1,76}/g)?.join("\r\n") || "", ""].join("\r\n");
  });
  return [headers.split("\r\n").map(line => line.startsWith("Content-Type: ") ? `Content-Type: multipart/mixed; boundary="${boundary}"` : line).join("\r\n"), "",
    `--${boundary}`, `Content-Type: ${contentType}`, "", raw.slice(split + 4), "", ...parts, `--${boundary}--`, ""].join("\r\n");
}
