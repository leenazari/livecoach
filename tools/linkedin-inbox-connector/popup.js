const keyInput = document.querySelector("#connector-key");
const limitInput = document.querySelector("#conversation-limit");
const warningInput = document.querySelector("#read-warning");
const syncButton = document.querySelector("#sync");
const forgetButton = document.querySelector("#forget");
const status = document.querySelector("#status");

const showStatus = (message, kind = "") => {
  status.textContent = message;
  status.className = kind;
};

const loadSettings = async () => {
  const saved = await chrome.storage.local.get([
    "connectorToken",
    "maxConversations",
    "lastSuccessfulSyncAt",
  ]);
  keyInput.value = saved.connectorToken || "";
  limitInput.value = String(saved.maxConversations || 10);
  if (saved.lastSuccessfulSyncAt) {
    showStatus(
      `Last successful sync ${new Date(saved.lastSuccessfulSyncAt).toLocaleString("en-GB")}.`
    );
  } else {
    showStatus("Ready when your main LinkedIn Messaging inbox is open.");
  }
};

const startSync = async () => {
  const token = String(keyInput.value || "").trim();
  const maxConversations = Number(limitInput.value || 10);
  if (!/^lci_[A-Za-z0-9_-]{40,80}$/.test(token)) {
    showStatus("Paste the inbox key created in LiveCoach Settings.", "error");
    return;
  }
  if (!warningInput.checked) {
    showStatus("Confirm the LinkedIn account-risk warning before syncing.", "error");
    return;
  }
  syncButton.disabled = true;
  forgetButton.disabled = true;
  showStatus("Scanning changed conversations. Do not close the LinkedIn tab.");
  try {
    await chrome.storage.local.set({ connectorToken: token, maxConversations });
    const response = await chrome.runtime.sendMessage({
      type: "LIVECOACH_START_SYNC",
      token,
      maxConversations,
    });
    if (!response?.ok) throw new Error(response?.error || "Sync did not complete.");
    const result = response.result || {};
    showStatus(
      `${result.imported || 0} new messages imported. ${result.duplicates || 0} duplicates ignored. ${result.review || 0} leads need company review.`,
      "success"
    );
  } catch (error) {
    showStatus(String(error?.message || error), "error");
  } finally {
    syncButton.disabled = false;
    forgetButton.disabled = false;
  }
};

const forgetKey = async () => {
  await chrome.storage.local.remove([
    "connectorToken",
    "conversationFingerprints",
    "lastSuccessfulSyncAt",
  ]);
  keyInput.value = "";
  warningInput.checked = false;
  showStatus("Saved connector key and local sync history removed.");
};

syncButton.addEventListener("click", () => void startSync());
forgetButton.addEventListener("click", () => void forgetKey());
void loadSettings();
