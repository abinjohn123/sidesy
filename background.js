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
