// Firefox (MV3 event page) + Chrome (MV3 service worker) compatible background.
// In Firefox the manifest lists ["constants.js", "background.js"] as
// background.scripts sharing one global scope; in Chrome only background.js
// runs as a service worker, so load constants via importScripts there.
if (typeof CONSTANTS === "undefined" && typeof importScripts === "function") {
  try {
    importScripts("constants.js");
  } catch {
    // constants.js already loaded via background.scripts — ignore.
  }
}

// `browser` (Firefox, promise-based) with `chrome` (Chromium) fallback.
const ext = globalThis.browser ?? globalThis.chrome;

ext.runtime.onInstalled.addListener((details) => {
  const version = ext.runtime.getManifest().version;
  const now = Date.now();

  if (CONSTANTS.DEVELOPER_MESSAGE?.enabled && CONSTANTS.DEVELOPER_MESSAGE.id) {
    ext.storage.local.get(["developer_message_state"]).then((data) => {
      const state = data.developer_message_state;
      if (state?.campaignId === CONSTANTS.DEVELOPER_MESSAGE.id) return;

      ext.storage.local.set({
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
    ext.tabs.create({ url: CONSTANTS.WELCOME_PAGE_URL });
    // Seed so new users never see "What's New"
    ext.storage.local.set({
      extension_installed_at: now,
      last_seen_announcement: version,
    });
  }

  if (details.reason === "update") {
    ext.storage.local.set({ extension_updated_at: now });
    ext.storage.local.get(["last_seen_announcement"]).then((data) => {
      const hasItems = CONSTANTS.ANNOUNCEMENT.items.length > 0;
      if (!hasItems) {
        ext.storage.local.set({
          last_seen_announcement: version,
          pending_announcement: null,
        });
        return;
      }

      if (data.last_seen_announcement !== version) {
        ext.storage.local.set({ pending_announcement: version });
      }
    });
  }
});

function getToggleShortcutInfo() {
  return ext.commands.getAll().then((commands) => {
    const toggleCommand = commands.find(({ name }) => name === "toggle-sidebar");
    const shortcut = toggleCommand?.shortcut?.trim() ?? "";

    return {
      shortcut,
      isRegistered: shortcut.length > 0,
    };
  });
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
ext.commands.onCommand.addListener((command) => {
  if (command === "toggle-sidebar") {
    // Promise style works in Firefox (browser.*) and modern Chrome.
    ext.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id != null) {
        ext.tabs.sendMessage(tabs[0].id, { action: "toggle-sidebar" }).catch(() => {
          // Tab has no content script (e.g. not a watch page) — ignore.
        });
      }
    }).catch(() => {});
  }
});
