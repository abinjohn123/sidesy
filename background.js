importScripts("constants.js");

chrome.runtime.onInstalled.addListener((details) => {
  const version = chrome.runtime.getManifest().version;
  const now = Date.now();

  if (CONSTANTS.DEVELOPER_MESSAGE?.enabled && CONSTANTS.DEVELOPER_MESSAGE.id) {
    chrome.storage.local.get(["developer_message_state"]).then((data) => {
      const state = data.developer_message_state;
      if (state?.campaignId === CONSTANTS.DEVELOPER_MESSAGE.id) return;

      chrome.storage.local.set({
        developer_message_state: {
          campaignId: CONSTANTS.DEVELOPER_MESSAGE.id,
          firstSeenAt: now,
          dismissedAt: null,
          clickedAt: null,
          remindAfter: null,
          reminderCount: 0,
        },
      });
    });
  }

  if (details.reason === "install") {
    chrome.tabs.create({ url: CONSTANTS.WELCOME_PAGE_URL });
    // Seed so new users never see "What's New"
    chrome.storage.local.set({
      extension_installed_at: now,
      last_seen_announcement: version,
    });
  }

  if (details.reason === "update") {
    chrome.storage.local.set({ extension_updated_at: now });
    chrome.storage.local.get(["last_seen_announcement"]).then((data) => {
      const hasItems = CONSTANTS.ANNOUNCEMENT.items.length > 0;
      if (hasItems && data.last_seen_announcement !== version) {
        chrome.storage.local.set({ pending_announcement: version });
      }
    });
  }
});

function getToggleShortcutInfo() {
  return chrome.commands.getAll().then((commands) => {
    const toggleCommand = commands.find(({ name }) => name === "toggle-sidebar");
    const shortcut = toggleCommand?.shortcut?.trim() ?? "";

    return {
      shortcut,
      isRegistered: shortcut.length > 0,
    };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "get-toggle-shortcut-info") {
    getToggleShortcutInfo()
      .then((shortcutInfo) => sendResponse(shortcutInfo))
      .catch(() => sendResponse({ shortcut: "", isRegistered: false }));
    return true;
  }
});

/**
 * Keyboard shortcut handler.
 * Forwards the toggle-sidebar command to the active tab's content script.
 */
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "toggle-sidebar" });
      }
    });
  }
});
