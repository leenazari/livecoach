const LIVECOACH_IMPORT_URL =
  "https://www.livecoachcrm.com/api/connectors/linkedin-inbox/import";

const activeLinkedInTab = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !String(tab.url || "").startsWith("https://www.linkedin.com/messaging/")) {
    throw new Error("Open your main LinkedIn Messaging inbox before syncing.");
  }
  return tab;
};

const postBatch = async (token, batch) => {
  const response = await fetch(LIVECOACH_IMPORT_URL, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-LiveCoach-Extension-Id": chrome.runtime.id,
    },
    body: JSON.stringify(batch),
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error("LiveCoach returned an unexpected response.");
  }
  if (!response.ok) {
    throw new Error(data.error || `LiveCoach import failed (${response.status}).`);
  }
  return data;
};

const runSync = async ({ token, maxConversations }) => {
  if (!/^lci_[A-Za-z0-9_-]{40,80}$/.test(String(token || ""))) {
    throw new Error("Paste a valid LiveCoach inbox key first.");
  }
  const limit = Math.min(20, Math.max(1, Math.trunc(Number(maxConversations) || 10)));
  const tab = await activeLinkedInTab();
  const stored = await chrome.storage.local.get("conversationFingerprints");
  const capture = await chrome.tabs.sendMessage(tab.id, {
    type: "LIVECOACH_CAPTURE_INBOUND",
    maxConversations: limit,
    lookbackDays: 14,
    conversationFingerprints: stored.conversationFingerprints || {},
  });
  if (!capture?.ok) {
    throw new Error(capture?.error || "LinkedIn capture did not complete.");
  }
  const batch = {
    runId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    conversationCount: capture.conversationCount,
    messages: capture.messages,
  };
  const result = await postBatch(token, batch);
  await chrome.storage.local.set({
    conversationFingerprints: capture.conversationFingerprints || {},
    lastSuccessfulSyncAt: new Date().toISOString(),
  });
  return {
    ...result,
    scanned: capture.conversationCount,
    unchanged: capture.unchanged,
  };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "LIVECOACH_START_SYNC") return false;
  runSync(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({ ok: false, error: String(error?.message || error) })
    );
  return true;
});
