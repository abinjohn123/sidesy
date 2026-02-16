importScripts("constants.js");

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
