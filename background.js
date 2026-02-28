importScripts("constants.js");

/**
 * Redirection to Welcome Page
 * after extension has been installed.
 */

chrome.runtime.onInstalled.addListener((details) => {
  const version = chrome.runtime.getManifest().version;

  if (details.reason === "install") {
    chrome.tabs.create({ url: CONSTANTS.WELCOME_PAGE_URL });
    // Seed so new users never see "What's New"
    chrome.storage.local.set({ last_seen_announcement: version });
  }

  if (details.reason === "update") {
    chrome.storage.local.get(["last_seen_announcement"]).then((data) => {
      const hasItems = CONSTANTS.ANNOUNCEMENT.items.length > 0;
      if (hasItems && data.last_seen_announcement !== version) {
        chrome.storage.local.set({ pending_announcement: version });
      }
    });
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
