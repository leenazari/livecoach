const SELECTORS = Object.freeze({
  conversationList:
    "ul.msg-conversations-container__conversations-list[aria-label='Conversation List']",
  conversationItem: "li.msg-conversation-listitem",
  conversationButton: ".msg-conversation-listitem__link",
  participantName: ".msg-conversation-listitem__participant-names",
  conversationTime: ".msg-conversation-listitem__time-stamp",
  preview: ".msg-conversation-card__message-snippet",
  activeConversation: "li.msg-conversation-listitem--active",
  threadProfile: "a.msg-thread__link-to-profile[href*='/in/']",
  messageList: "ul.msg-s-message-list-content",
  inboundMessage:
    "div.msg-s-event-listitem.msg-s-event-listitem--other[data-event-urn]",
  messageBody: ".msg-s-event-listitem__body",
  senderName: ".msg-s-message-group__name",
  senderProfile: "a.msg-s-event-listitem__link[href*='/in/']",
});

let captureRunning = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalText = (value) =>
  String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

const failIfChallenge = () => {
  const url = String(window.location.href || "").toLowerCase();
  const challenge = document.querySelector(
    "form[action*='checkpoint'], iframe[src*='checkpoint'], [data-test-id*='challenge']"
  );
  if (url.includes("/checkpoint/") || challenge) {
    throw new Error(
      "LinkedIn is showing a security challenge. The connector stopped without continuing."
    );
  }
};

const waitFor = async (predicate, message, timeoutMs = 8_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    failIfChallenge();
    const value = predicate();
    if (value) return value;
    await sleep(150);
  }
  throw new Error(message);
};

const canonicalProfileUrl = (value) => {
  try {
    const url = new URL(value, window.location.origin);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      !(host === "linkedin.com" || host.endsWith(".linkedin.com"))
    ) {
      return null;
    }
    const match = url.pathname.match(/^\/in\/([^/?#]+)\/?$/i);
    if (!match?.[1]) return null;
    return `https://www.linkedin.com/in/${match[1]}`;
  } catch {
    return null;
  }
};

const conversationIdFromUrl = (value) => {
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/\/messaging\/thread\/([^/]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).slice(0, 500) : null;
  } catch {
    return null;
  }
};

const conversationSnapshot = (item) => {
  const href = item
    .querySelector(SELECTORS.conversationButton)
    ?.getAttribute("href");
  const threadId = conversationIdFromUrl(href);
  const hrefKey = String(href || "").slice(0, 500);
  const name = normalText(item.querySelector(SELECTORS.participantName)?.textContent);
  const time = normalText(item.querySelector(SELECTORS.conversationTime)?.textContent);
  const preview = normalText(item.querySelector(SELECTORS.preview)?.textContent);
  const fullText = normalText(item.textContent).toLowerCase();
  const sponsored =
    fullText.includes("sponsored") ||
    name.toLowerCase() === "linkedin offer" ||
    name.toLowerCase() === "linkedin";
  return {
    name,
    time,
    preview,
    sponsored,
    threadId,
    storageKey: threadId
      ? `thread:${threadId}`
      : hrefKey
        ? `href:${hrefKey}`
        : `name:${name.toLowerCase()}`,
    fingerprint: `${threadId || hrefKey}|${name.toLowerCase()}|${time.toLowerCase()}|${preview}`.slice(
      0,
      1_500
    ),
  };
};

const timestampFromEvent = (event, eventUrn) => {
  const explicit = event.querySelector("time[datetime]")?.getAttribute("datetime");
  if (explicit) {
    const ms = new Date(explicit).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }

  const urn = String(eventUrn || "");
  const targeted = urn.match(/,\d+-([A-Za-z0-9+/_=-]{20,})\)/)?.[1];
  const generic = (urn.match(/[A-Za-z0-9+/_=-]{20,}/g) || []).map((candidate) =>
    candidate.replace(/^\d+-/, "")
  );
  const candidates = [targeted, ...generic.reverse()].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const base64 = candidate.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const decoded = atob(padded);
      const match = decoded.match(/(?:^|\D)(\d{13})(?:\D|$)/);
      const ms = Number(match?.[1]);
      if (ms > 1_262_304_000_000 && ms < Date.now() + 10 * 60 * 1_000) {
        return new Date(ms).toISOString();
      }
    } catch {
      // Try the next encoded component. An unparseable timestamp is skipped.
    }
  }
  return null;
};

const currentConversationId = () => {
  return conversationIdFromUrl(window.location.href);
};

const extractInboundMessages = (fallbackName) => {
  const headerProfile = canonicalProfileUrl(
    document.querySelector(SELECTORS.threadProfile)?.getAttribute("href")
  );
  const conversationId = currentConversationId();
  if (!conversationId) {
    throw new Error("LinkedIn did not expose the active conversation identity.");
  }
  const results = [];
  const seen = new Set();
  for (const event of document.querySelectorAll(SELECTORS.inboundMessage)) {
    const eventUrn = normalText(event.getAttribute("data-event-urn"));
    const body = normalText(event.querySelector(SELECTORS.messageBody)?.textContent).slice(
      0,
      8_000
    );
    const senderName =
      normalText(event.querySelector(SELECTORS.senderName)?.textContent) || fallbackName;
    const senderProfileUrl =
      canonicalProfileUrl(
        event.querySelector(SELECTORS.senderProfile)?.getAttribute("href")
      ) || headerProfile;
    const receivedAt = timestampFromEvent(event, eventUrn);
    if (!eventUrn || !body || !senderName || !senderProfileUrl || !receivedAt) continue;
    if (seen.has(eventUrn)) continue;
    seen.add(eventUrn);
    results.push({
      direction: "inbound",
      conversationId,
      messageId: eventUrn.slice(0, 1_000),
      senderName: senderName.slice(0, 240),
      senderProfileUrl,
      body,
      receivedAt,
    });
  }
  return results;
};

const clickConversation = async (snapshot) => {
  const items = [...document.querySelectorAll(SELECTORS.conversationItem)];
  const item = items.find((candidate) => {
    const candidateSnapshot = conversationSnapshot(candidate);
    return snapshot.threadId
      ? candidateSnapshot.threadId === snapshot.threadId
      : candidateSnapshot.fingerprint === snapshot.fingerprint;
  });
  const button = item?.querySelector(SELECTORS.conversationButton);
  if (!(button instanceof HTMLElement)) {
    throw new Error("LinkedIn changed the conversation controls. The connector stopped.");
  }
  button.click();
  await waitFor(
    () => {
      const profile = document.querySelector(SELECTORS.threadProfile);
      const headerName = normalText(profile?.textContent).toLowerCase();
      const wantedName = snapshot.name.toLowerCase();
      const namesMatch =
        headerName === wantedName ||
        headerName.includes(wantedName) ||
        wantedName.includes(headerName);
      const conversationMatches = snapshot.threadId
        ? currentConversationId() === snapshot.threadId
        : namesMatch;
      return (
        document.querySelector(SELECTORS.messageList) &&
        currentConversationId() &&
        canonicalProfileUrl(profile?.getAttribute("href")) &&
        headerName &&
        conversationMatches
      );
    },
    `LinkedIn did not open the conversation with ${snapshot.name}.`
  );
  await sleep(350);
};

const captureInbound = async (request) => {
  failIfChallenge();
  const url = new URL(window.location.href);
  if (!url.pathname.startsWith("/messaging/")) {
    throw new Error("Open LinkedIn Messaging before syncing.");
  }
  if (url.searchParams.has("filter")) {
    throw new Error("Switch LinkedIn to the main Inbox filter before syncing.");
  }
  const list = await waitFor(
    () => document.querySelector(SELECTORS.conversationList),
    "LinkedIn's conversation list was not found. The connector stopped."
  );
  const maxConversations = Math.min(
    20,
    Math.max(1, Math.trunc(Number(request.maxConversations) || 10))
  );
  const lookbackDays = Math.min(
    14,
    Math.max(1, Math.trunc(Number(request.lookbackDays) || 14))
  );
  const oldestAllowed = Date.now() - lookbackDays * 24 * 60 * 60 * 1_000;
  const previous = request.conversationFingerprints || {};
  const nextFingerprints = { ...previous };
  const snapshots = [...list.querySelectorAll(SELECTORS.conversationItem)]
    .slice(0, maxConversations)
    .map(conversationSnapshot)
    .filter((snapshot) => snapshot.name && !snapshot.sponsored);
  const currentHeaderName = normalText(
    document.querySelector(SELECTORS.threadProfile)?.textContent
  ).toLowerCase();
  const originalThreadId = currentConversationId();
  const originalSnapshot =
    snapshots.find(
      (snapshot) =>
        originalThreadId && snapshot.threadId === originalThreadId
    ) ||
    snapshots.find((snapshot) =>
      currentHeaderName.includes(snapshot.name.toLowerCase())
    );
  if (!snapshots.length) {
    throw new Error("No normal person-to-person conversations were found in this inbox view.");
  }

  const messages = [];
  let opened = 0;
  let unchanged = 0;
  for (const snapshot of snapshots) {
    failIfChallenge();
    const key = snapshot.storageKey;
    if (previous[key] === snapshot.fingerprint) {
      unchanged += 1;
      continue;
    }
    await clickConversation(snapshot);
    opened += 1;
    const extracted = extractInboundMessages(snapshot.name).filter(
      (message) => new Date(message.receivedAt).getTime() >= oldestAllowed
    );
    messages.push(...extracted);
    if (messages.length > 200) {
      throw new Error(
        "More than 200 recent inbound messages were found. Lower the conversation limit and run Sync again. Nothing was imported."
      );
    }
    nextFingerprints[key] = snapshot.fingerprint;
  }

  if (originalSnapshot && originalSnapshot.fingerprint) {
    try {
      await clickConversation(originalSnapshot);
    } catch {
      // The import data is still valid. Leave LinkedIn on the final scanned thread.
    }
  }

  const unique = [];
  const ids = new Set();
  for (const message of messages) {
    if (ids.has(message.messageId)) continue;
    ids.add(message.messageId);
    unique.push(message);
  }
  return {
    ok: true,
    conversationCount: opened,
    unchanged,
    messages: unique,
    conversationFingerprints: nextFingerprints,
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "LIVECOACH_CAPTURE_INBOUND") return false;
  if (captureRunning) {
    sendResponse({ ok: false, error: "A LinkedIn inbox sync is already running." });
    return false;
  }
  captureRunning = true;
  captureInbound(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: String(error?.message || error) })
    )
    .finally(() => {
      captureRunning = false;
    });
  return true;
});
