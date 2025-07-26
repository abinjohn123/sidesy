importScripts("constants.js");

/**
 * Redirection to Welcome Page
 * after extension has been installed.
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: CONSTANTS.WELCOME_PAGE_URL,
    });
  }
});

/**
 * A service worker that checks if a YouTube page
 * has been loaded and triggers the extension.
 */

chrome.tabs.onUpdated.addListener(function (_, changeInfo, tab) {
  if (tab.url.includes("youtube.com/watch") && changeInfo.status === "complete")
    chrome.tabs.sendMessage(_, { activate: true });
});
