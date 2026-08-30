"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import NavMenu from "@/components/crm/NavMenu";
import {
  CHAT_ALLOWED_MIME_TYPES,
  CHAT_FILE_BUCKET,
  CHAT_INLINE_PREVIEW_MIME_TYPES,
  CHAT_MAX_FILE_BYTES,
} from "@/lib/crm-chat-shared";
import { crmFetch } from "@/lib/crm";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

type WorkspaceMember = {
  userId: string;
  displayName: string;
  email: string | null;
  role: "owner" | "manager" | "sales";
};

type Conversation = {
  id: string;
  kind: "direct" | "group";
  name: string;
  members: Array<{
    userId: string;
    displayName: string;
    email: string | null;
  }>;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessage: {
    senderUserId: string;
    senderName: string;
    preview: string;
    createdAt: string;
  } | null;
};

type ChatFeed = {
  currentUserId: string;
  conversations: Conversation[];
  members: WorkspaceMember[];
};

type ChatAttachment = {
  id: string;
  kind: "file" | "company" | "contact" | "opportunity" | "crm_link";
  targetId: string | null;
  title: string;
  subtitle: string | null;
  href: string | null;
  snapshot: Record<string, any>;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
};

type ChatMessage = {
  id: string;
  senderUserId: string;
  senderName: string;
  body: string;
  attachments: ChatAttachment[];
  createdAt: string;
};

type MessagesFeed = {
  currentUserId: string;
  conversation: {
    id: string;
    kind: "direct" | "group";
    name: string | null;
    members: Array<{ userId: string; displayName: string }>;
  };
  messages: ChatMessage[];
};

type PendingShare = {
  kind: "company" | "contact";
  id: string;
  label: string;
};

type PreparedChatUpload = {
  path: string;
  token: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

type DriveSaveState = {
  status: "saving" | "saved" | "error";
  webViewLink?: string;
  message?: string;
  requiresReconnect?: boolean;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const primaryButton =
  "min-h-11 rounded-lg border border-amber/55 bg-amber/10 px-4 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-wait disabled:opacity-40";
const secondaryButton =
  "min-h-11 rounded-lg border border-edge px-4 font-mono text-[0.6rem] uppercase tracking-wider text-bone transition hover:border-amber/50 hover:text-amber disabled:opacity-40";

const formatTime = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const fileSize = (bytes: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const chatFileError = (selectedFile: File) => {
  if (selectedFile.size > CHAT_MAX_FILE_BYTES) {
    return "Files are limited to 20 MB";
  }
  if (!CHAT_ALLOWED_MIME_TYPES.has(selectedFile.type)) {
    return "That file type is not allowed in CRM chat";
  }
  return "";
};

const attachmentFileUrl = (
  attachment: ChatAttachment,
  mode: "open" | "download"
) => {
  if (!attachment.href) return "";
  const separator = attachment.href.includes("?") ? "&" : "?";
  return `${attachment.href}${separator}mode=${mode}`;
};

function DriveSaveMessage({ state }: { state?: DriveSaveState }) {
  if (!state || state.status === "saving") return null;
  if (state.status === "saved") {
    return (
      <p className="mt-2 text-xs leading-5 text-sage">
        Saved in your Google Drive.
      </p>
    );
  }
  return (
    <p role="alert" className="mt-2 text-xs leading-5 text-rust">
      {state.message || "The file could not be saved to Google Drive."}{" "}
      {state.requiresReconnect ? (
        <a
          href="/api/auth/google/start"
          className="font-medium text-amber underline decoration-amber/50 underline-offset-2"
        >
          Grant Drive access
        </a>
      ) : null}
    </p>
  );
}

function DriveFileAction({
  attachment,
  state,
  onSave,
  className = "",
}: {
  attachment: ChatAttachment;
  state?: DriveSaveState;
  onSave: (attachment: ChatAttachment) => void;
  className?: string;
}) {
  if (state?.status === "saved" && state.webViewLink) {
    return (
      <a
        href={state.webViewLink}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        Open Drive
      </a>
    );
  }
  if (state?.requiresReconnect) {
    return (
      <a href="/api/auth/google/start" className={className}>
        Grant Drive access
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onSave(attachment)}
      disabled={state?.status === "saving"}
      className={className}
    >
      {state?.status === "saving"
        ? "Saving to Drive…"
        : state?.status === "error"
          ? "Try Drive again"
          : "Save to Drive"}
    </button>
  );
}

function FilePreviewDialog({
  attachment,
  driveState,
  onSaveToDrive,
  onClose,
}: {
  attachment: ChatAttachment;
  driveState?: DriveSaveState;
  onSaveToDrive: (attachment: ChatAttachment) => void;
  onClose: () => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const mimeType = attachment.mimeType || "";
  const previewUrl = attachmentFileUrl(attachment, "open");
  const downloadUrl = attachmentFileUrl(attachment, "download");
  const titleId = `chat-file-preview-${attachment.id}`;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const preview = previewFailed ? (
    <div className="m-auto max-w-md p-8 text-center">
      <p className="text-base text-bone">This file did not render in your browser.</p>
      <p className="mt-2 text-sm leading-6 text-muted">
        You can still download and open it on your device.
      </p>
    </div>
  ) : mimeType.startsWith("image/") ? (
    <img
      src={previewUrl}
      alt={attachment.fileName || attachment.title}
      className="h-full w-full object-contain"
      onError={() => setPreviewFailed(true)}
    />
  ) : mimeType.startsWith("audio/") ? (
    <div className="m-auto w-full max-w-2xl p-6">
      <audio
        controls
        className="w-full"
        src={previewUrl}
        onError={() => setPreviewFailed(true)}
      >
        Your browser cannot play this audio file.
      </audio>
    </div>
  ) : mimeType.startsWith("video/") ? (
    <video
      controls
      playsInline
      className="h-full w-full object-contain"
      src={previewUrl}
      onError={() => setPreviewFailed(true)}
    >
      Your browser cannot play this video file.
    </video>
  ) : (
    <iframe
      title={`Preview of ${attachment.fileName || attachment.title}`}
      src={previewUrl}
      className="h-full min-h-[24rem] w-full border-0 bg-white"
      referrerPolicy="no-referrer"
    />
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex h-[min(52rem,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl">
        <header className="flex flex-wrap items-center gap-3 border-b border-edge px-3 py-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-medium text-bone">
              {attachment.fileName || attachment.title}
            </h2>
            <p className="mt-0.5 font-mono text-[0.48rem] uppercase tracking-wider text-muted">
              {fileSize(attachment.fileSize)}
            </p>
          </div>
          <a href={downloadUrl} className={secondaryButton}>
            Download
          </a>
          <DriveFileAction
            attachment={attachment}
            state={driveState}
            onSave={onSaveToDrive}
            className={`${secondaryButton} inline-flex items-center justify-center`}
          />
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg border border-edge text-xl text-muted transition hover:border-amber/50 hover:text-bone"
            aria-label="Close file preview"
          >
            ×
          </button>
        </header>
        <div className="flex min-h-0 flex-1 bg-ink/80">{preview}</div>
        <div className="border-t border-edge px-3 py-2 sm:px-4">
          <p className="text-xs text-muted">
            If this format does not render in your browser, download it instead.
          </p>
          <DriveSaveMessage state={driveState} />
        </div>
      </section>
    </div>
  );
}

function AttachmentCard({
  attachment,
  driveState,
  onPreview,
  onSaveToDrive,
}: {
  attachment: ChatAttachment;
  driveState?: DriveSaveState;
  onPreview: (attachment: ChatAttachment) => void;
  onSaveToDrive: (attachment: ChatAttachment) => void;
}) {
  const canPreview =
    attachment.kind === "file" &&
    CHAT_INLINE_PREVIEW_MIME_TYPES.has(attachment.mimeType || "");
  const inner = (
    <div className="rounded-lg border border-edge bg-ink/45 p-3 transition hover:border-amber/50">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber/35 bg-amber/10 text-amber">
          {attachment.kind === "file"
            ? "↓"
            : attachment.kind === "contact"
              ? "@"
              : "◴"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-bone">
            {attachment.title}
          </p>
          <p className="mt-0.5 truncate font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            {attachment.kind === "file"
              ? fileSize(attachment.fileSize)
              : attachment.subtitle || attachment.kind.replace("_", " ")}
          </p>
          {attachment.kind === "contact" && attachment.snapshot?.email ? (
            <p className="mt-1 truncate text-xs text-sky">
              {String(attachment.snapshot.email)}
            </p>
          ) : null}
        </div>
        {attachment.kind !== "file" ? <span className="text-muted">↗</span> : null}
      </div>
      {attachment.kind === "file" && attachment.href ? (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-edge pt-3">
          {canPreview ? (
            <button
              type="button"
              onClick={() => onPreview(attachment)}
              className={`${secondaryButton} min-h-9 flex-1 px-3`}
            >
              Open
            </button>
          ) : null}
          <a
            href={attachmentFileUrl(attachment, "download")}
            className={`${secondaryButton} inline-flex min-h-9 flex-1 items-center justify-center px-3`}
          >
            Download
          </a>
          <DriveFileAction
            attachment={attachment}
            state={driveState}
            onSave={onSaveToDrive}
            className={`${secondaryButton} inline-flex min-h-9 flex-1 items-center justify-center px-3`}
          />
        </div>
      ) : null}
      {attachment.kind === "file" ? (
        <DriveSaveMessage state={driveState} />
      ) : null}
    </div>
  );
  return attachment.href ? (
    attachment.kind !== "file" ? (
      <Link href={attachment.href} className="block">
        {inner}
      </Link>
    ) : inner
  ) : (
    inner
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const requestedConversation = searchParams.get("conversation") || "";
  const shareType = searchParams.get("shareType") || "";
  const shareId = searchParams.get("shareId") || "";
  const shareLabel = (searchParams.get("shareLabel") || "CRM record").slice(0, 120);
  const pendingShare: PendingShare | null =
    (shareType === "company" || shareType === "contact") && UUID.test(shareId)
      ? { kind: shareType, id: shareId, label: shareLabel }
      : null;

  const [feed, setFeed] = useState<ChatFeed | null>(null);
  const [selectedId, setSelectedId] = useState(
    UUID.test(requestedConversation) ? requestedConversation : ""
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [clientNonce, setClientNonce] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<"direct" | "group">("direct");
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    () => new Set()
  );
  const [creating, setCreating] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<ChatAttachment | null>(null);
  const [driveStates, setDriveStates] = useState<Record<string, DriveSaveState>>(
    {}
  );
  const fileInput = useRef<HTMLInputElement | null>(null);
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const driveSaving = useRef<Set<string>>(new Set());

  const selectedConversation = useMemo(
    () => feed?.conversations.find((item) => item.id === selectedId) || null,
    [feed?.conversations, selectedId]
  );

  const saveAttachmentToDrive = useCallback(async (attachment: ChatAttachment) => {
    if (attachment.kind !== "file" || driveSaving.current.has(attachment.id)) {
      return;
    }
    driveSaving.current.add(attachment.id);
    setDriveStates((current) => ({
      ...current,
      [attachment.id]: { status: "saving" },
    }));
    try {
      const result = await crmFetch<{
        created: boolean;
        fileId: string;
        fileName: string;
        webViewLink: string;
      }>(`/api/crm/chat/files/${attachment.id}/drive`, {
        method: "POST",
      });
      if (!result.webViewLink) {
        throw new Error("Google Drive did not return the saved file link");
      }
      setDriveStates((current) => ({
        ...current,
        [attachment.id]: {
          status: "saved",
          webViewLink: result.webViewLink,
        },
      }));
    } catch (reason: any) {
      const message = String(
        reason?.message || "The file could not be saved to Google Drive"
      );
      setDriveStates((current) => ({
        ...current,
        [attachment.id]: {
          status: "error",
          message,
          requiresReconnect:
            /connect google|reconnect google|grant livecoach permission/i.test(
              message
            ),
        },
      }));
    } finally {
      driveSaving.current.delete(attachment.id);
    }
  }, []);

  const loadFeed = useCallback(async () => {
    const next = await crmFetch<ChatFeed>("/api/crm/chat");
    setFeed(next);
    setSelectedId((current) => {
      if (current && next.conversations.some((item) => item.id === current)) {
        return current;
      }
      if (
        UUID.test(requestedConversation) &&
        next.conversations.some((item) => item.id === requestedConversation)
      ) {
        return requestedConversation;
      }
      return next.conversations[0]?.id || "";
    });
    return next;
  }, [requestedConversation]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    try {
      const next = await crmFetch<MessagesFeed>(
        `/api/crm/chat/${conversationId}/messages`
      );
      setMessages(next.messages || []);
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadFeed()
      .then(() => {
        if (active) setError("");
      })
      .catch((reason: any) => {
        if (active) setError(reason?.message || "Team chat could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadFeed]);

  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId).catch((reason: any) =>
      setError(reason?.message || "Messages could not be loaded.")
    );
  }, [loadMessages, selectedId]);

  useEffect(() => {
    const refresh = () => {
      void loadFeed();
      if (selectedId) void loadMessages(selectedId);
    };
    const timer = window.setInterval(refresh, 20_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("lc:notifications-realtime", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("lc:notifications-realtime", refresh);
    };
  }, [loadFeed, loadMessages, selectedId]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const chooseConversation = (id: string) => {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("conversation", id);
    router.replace(`/crm/chat?${params.toString()}`, { scroll: false });
  };

  const clearPendingShare = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("shareType");
    params.delete("shareId");
    params.delete("shareLabel");
    router.replace(`/crm/chat${params.size ? `?${params.toString()}` : ""}`, {
      scroll: false,
    });
  };

  const resetCreate = () => {
    setCreateOpen(false);
    setCreateKind("direct");
    setGroupName("");
    setSelectedMembers(new Set());
  };

  const toggleMember = (userId: string) => {
    setSelectedMembers((current) => {
      if (createKind === "direct") return new Set([userId]);
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const createConversation = async () => {
    if (creating || !selectedMembers.size) return;
    setCreating(true);
    setError("");
    try {
      const result = await crmFetch<{ conversation: { id: string } }>(
        "/api/crm/chat",
        {
          method: "POST",
          body: JSON.stringify({
            kind: createKind,
            name: createKind === "group" ? groupName : undefined,
            memberIds: [...selectedMembers],
          }),
        }
      );
      await loadFeed();
      chooseConversation(result.conversation.id);
      resetCreate();
    } catch (reason: any) {
      setError(reason?.message || "Conversation could not be created.");
    } finally {
      setCreating(false);
    }
  };

  const sendMessage = async () => {
    if (
      !selectedId ||
      sending ||
      (!composer.trim() && !file && !pendingShare)
    ) {
      return;
    }
    setSending(true);
    setError("");
    try {
      let uploadedFile: PreparedChatUpload | null = null;
      if (file) {
        const validationError = chatFileError(file);
        if (validationError) throw new Error(validationError);
        uploadedFile = await crmFetch<PreparedChatUpload>(
          `/api/crm/chat/${selectedId}/uploads`,
          {
            method: "POST",
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type,
              fileSize: file.size,
            }),
          }
        );
        const { error: uploadError } = await supabase.storage
          .from(CHAT_FILE_BUCKET)
          .uploadToSignedUrl(uploadedFile.path, uploadedFile.token, file, {
            contentType: file.type,
            cacheControl: "0",
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }
      await crmFetch(
        `/api/crm/chat/${selectedId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            body: composer.trim(),
            clientNonce,
            recordKind: pendingShare?.kind,
            recordId: pendingShare?.id,
            file: uploadedFile
              ? {
                  path: uploadedFile.path,
                  fileName: uploadedFile.fileName,
                }
              : undefined,
          }),
        }
      );
      setComposer("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setClientNonce(crypto.randomUUID());
      if (pendingShare) clearPendingShare();
      await Promise.all([loadMessages(selectedId), loadFeed()]);
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
    } catch (reason: any) {
      setError(reason?.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const otherMembers = (feed?.members || []).filter(
    (member) => member.userId !== feed?.currentUserId
  );

  return (
    <main className="relative z-10 mx-auto max-w-[1360px] px-3 py-4 pb-24 sm:px-5 sm:py-7 sm:pb-10">
      <NavMenu />

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-edge pb-4">
        <div>
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-amber">
            Private workspace messaging
          </p>
          <h1 className="mt-1 font-display text-2xl tracking-tight text-bone sm:text-3xl">
            Team <span className="italic text-amber">chat</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Talk about CRM work, share safe client cards and keep files inside the selected conversation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className={primaryButton}
        >
          + New message or group
        </button>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust"
        >
          {error}
        </p>
      ) : null}

      {createOpen ? (
        <section className="mb-4 rounded-xl border border-amber/45 bg-panel p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.58rem] uppercase tracking-wider text-amber">
                Start a conversation
              </p>
              <p className="mt-1 text-sm text-muted">
                Only the people selected here can read its messages or files.
              </p>
            </div>
            <button
              type="button"
              onClick={resetCreate}
              className="min-h-10 min-w-10 rounded-full text-muted hover:text-bone"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            {(["direct", "group"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setCreateKind(kind);
                  setSelectedMembers(new Set());
                }}
                className={`${secondaryButton} flex-1 ${
                  createKind === kind ? "border-amber/60 bg-amber/10 text-amber" : ""
                }`}
              >
                {kind === "direct" ? "Direct message" : "Create group"}
              </button>
            ))}
          </div>
          {createKind === "group" ? (
            <label className="mt-3 block text-xs text-muted">
              Group name
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value.slice(0, 80))}
                placeholder="Recruitment team"
                className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-sm text-bone outline-none focus:border-amber/60"
              />
            </label>
          ) : null}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {otherMembers.map((member) => {
              const checked = selectedMembers.has(member.userId);
              return (
                <label
                  key={member.userId}
                  className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border p-3 ${
                    checked
                      ? "border-amber/55 bg-amber/10"
                      : "border-edge bg-ink/35"
                  }`}
                >
                  <input
                    type={createKind === "direct" ? "radio" : "checkbox"}
                    name="chat-member"
                    checked={checked}
                    onChange={() => toggleMember(member.userId)}
                    className="h-5 w-5 accent-amber"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-bone">
                      {member.displayName}
                    </span>
                    <span className="block truncate font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                      {member.role} · {member.email || "workspace account"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={resetCreate} className={secondaryButton}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createConversation()}
              disabled={
                creating ||
                !selectedMembers.size ||
                (createKind === "group" && !groupName.trim())
              }
              className={primaryButton}
            >
              {creating
                ? "Creating…"
                : createKind === "group"
                  ? "Create private group"
                  : "Open direct message"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid min-h-[68vh] overflow-hidden rounded-xl border border-edge bg-panel/90 shadow-2xl sm:grid-cols-[19rem_minmax(0,1fr)]">
        <aside
          className={`${selectedId ? "hidden sm:flex" : "flex"} min-h-[68vh] flex-col border-r border-edge`}
        >
          <div className="border-b border-edge p-3">
            <p className="font-mono text-[0.54rem] uppercase tracking-wider text-muted">
              Conversations · {feed?.conversations.length || 0}
            </p>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-muted">Loading chat…</p>
            ) : !feed?.conversations.length ? (
              <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                <p className="font-display text-lg text-bone">No conversations yet</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Start a direct message or create a private group with your organisation users.
                </p>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className={`${primaryButton} mt-4`}
                >
                  Start chatting
                </button>
              </div>
            ) : (
              feed.conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => chooseConversation(conversation.id)}
                  className={`border-b border-edge/70 p-3 text-left transition hover:bg-bone/[0.04] ${
                    selectedId === conversation.id ? "bg-amber/[0.08]" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink text-sm text-amber">
                      {conversation.kind === "group" ? "◫" : "@"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-bone">
                          {conversation.name}
                        </span>
                        {conversation.unreadCount > 0 ? (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber px-1.5 font-mono text-[0.48rem] text-ink">
                            {conversation.unreadCount > 99
                              ? "99+"
                              : conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted">
                        {conversation.lastMessage
                          ? `${conversation.lastMessage.senderName}: ${conversation.lastMessage.preview}`
                          : conversation.kind === "group"
                            ? `${conversation.members.length} members`
                            : "Start the conversation"}
                      </span>
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <div
          className={`${selectedId ? "flex" : "hidden sm:flex"} min-w-0 flex-col`}
        >
          {selectedConversation ? (
            <>
              <div className="flex items-center gap-3 border-b border-edge px-3 py-3 sm:px-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId("");
                    router.replace("/crm/chat", { scroll: false });
                  }}
                  className="min-h-10 min-w-10 rounded-full text-muted hover:text-amber sm:hidden"
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-medium text-bone">
                    {selectedConversation.name}
                  </h2>
                  <p className="truncate font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                    {selectedConversation.kind === "group"
                      ? `${selectedConversation.members.length} private members`
                      : selectedConversation.members
                          .filter((member) => member.userId !== feed?.currentUserId)
                          .map((member) => member.email || member.displayName)
                          .join(", ")}
                  </p>
                </div>
                <span className="hidden rounded-full border border-sage/35 bg-sage/10 px-3 py-1 font-mono text-[0.48rem] uppercase tracking-wider text-sage sm:inline-flex">
                  Members only
                </span>
              </div>

              <div className="flex min-h-[22rem] flex-1 flex-col gap-3 overflow-y-auto bg-ink/20 p-3 sm:p-4">
                {messagesLoading && !messages.length ? (
                  <p className="m-auto text-sm text-muted">Loading messages…</p>
                ) : !messages.length ? (
                  <div className="m-auto max-w-sm text-center">
                    <p className="font-display text-xl text-bone">
                      Start the conversation
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      Messages, files and CRM cards are available only to the people in this chat.
                    </p>
                  </div>
                ) : (
                  messages.map((message) => {
                    const mine = message.senderUserId === feed?.currentUserId;
                    return (
                      <article
                        key={message.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[min(42rem,88%)] rounded-2xl border px-3 py-2.5 ${
                            mine
                              ? "border-amber/35 bg-amber/[0.09]"
                              : "border-edge bg-panel"
                          }`}
                        >
                          <div className="mb-1 flex items-center justify-between gap-4">
                            <span className="font-mono text-[0.5rem] uppercase tracking-wider text-amber">
                              {mine ? "You" : message.senderName}
                            </span>
                            <time className="font-mono text-[0.46rem] uppercase text-muted">
                              {formatTime(message.createdAt)}
                            </time>
                          </div>
                          {message.body ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-bone">
                              {message.body}
                            </p>
                          ) : null}
                          {message.attachments.length ? (
                            <div className={`${message.body ? "mt-2" : ""} grid gap-2`}>
                              {message.attachments.map((attachment) => (
                                <AttachmentCard
                                  key={attachment.id}
                                  attachment={attachment}
                                  driveState={driveStates[attachment.id]}
                                  onPreview={setPreviewAttachment}
                                  onSaveToDrive={saveAttachmentToDrive}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })
                )}
                <div ref={messageEnd} />
              </div>

              <div className="border-t border-edge bg-panel p-3 sm:p-4">
                {pendingShare ? (
                  <div className="mb-2 flex items-center gap-3 rounded-lg border border-sky/40 bg-sky/[0.07] p-3">
                    <span className="text-sky">
                      {pendingShare.kind === "contact" ? "@" : "◴"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-bone">
                        Share {pendingShare.label}
                      </span>
                      <span className="block text-xs text-muted">
                        Only the safe card fields are copied into this conversation.
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={clearPendingShare}
                      className="min-h-9 min-w-9 rounded-full text-muted hover:text-bone"
                      aria-label="Remove shared record"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                {file ? (
                  <div className="mb-2 flex items-center gap-3 rounded-lg border border-edge bg-ink/40 p-3">
                    <span className="text-amber">↓</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-bone">
                      {file.name} · {fileSize(file.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                      className="min-h-9 min-w-9 rounded-full text-muted hover:text-bone"
                      aria-label="Remove file"
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value.slice(0, 5000))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={2}
                  placeholder={`Message ${selectedConversation.name}`}
                  className="w-full resize-none rounded-xl border border-edge bg-ink px-3 py-2.5 text-sm leading-6 text-bone outline-none placeholder:text-muted/60 focus:border-amber/60"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className={`${secondaryButton} inline-flex cursor-pointer items-center justify-center`}>
                    Attach file
                    <input
                      ref={fileInput}
                      type="file"
                      className="sr-only"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp,.heic,.mp3,.m4a,.wav,.webm,.mp4,.mov"
                      onChange={(event) => {
                        const selectedFile = event.target.files?.[0] || null;
                        if (selectedFile) {
                          const validationError = chatFileError(selectedFile);
                          if (validationError) {
                            setFile(null);
                            setError(validationError);
                            event.target.value = "";
                            return;
                          }
                        }
                        setError("");
                        setFile(selectedFile);
                      }}
                    />
                  </label>
                  <span className="hidden flex-1 text-right font-mono text-[0.48rem] uppercase tracking-wider text-muted sm:block">
                    Enter to send · Shift Enter for a new line · Files up to 20 MB
                  </span>
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={
                      sending || (!composer.trim() && !file && !pendingShare)
                    }
                    className={`${primaryButton} ml-auto`}
                  >
                    {sending ? "Sending…" : "Send message"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="m-auto max-w-md p-8 text-center">
              <p className="font-display text-xl text-bone">Choose a conversation</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                Or start a new direct message or group with people in your LiveCoach workspace.
              </p>
            </div>
          )}
        </div>
      </section>

      <p className="mt-3 text-xs leading-5 text-muted">
        Shared cards are a conversation snapshot. Full CRM access remains governed by the client privacy and assignment controls.
      </p>

      {previewAttachment ? (
        <FilePreviewDialog
          key={previewAttachment.id}
          attachment={previewAttachment}
          driveState={driveStates[previewAttachment.id]}
          onSaveToDrive={saveAttachmentToDrive}
          onClose={() => setPreviewAttachment(null)}
        />
      ) : null}
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<main className="p-8 text-sm text-muted">Loading team chat…</main>}>
      <ChatPageInner />
    </Suspense>
  );
}
