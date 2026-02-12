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
