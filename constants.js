// Firefox port: constants shared between background event page and content script.
// Use globalThis assignment (not `const`) so double-evaluation via
// background.scripts + the importScripts fallback below can't throw
// "redeclaration of CONSTANTS".
globalThis.CONSTANTS = globalThis.CONSTANTS || {
  WELCOME_PAGE_URL: "https://abinjohn123.github.io/sidesy-landing/",
  POPUP_LINKS: [
    {
      label: "See Sidesy in action",
      description: "A quick, 20-second walkthrough",
      icon: "popup/icons/walkthrough.svg",
      hoverColor: "#4285f4",
      url: "https://abinjohn123.github.io/sidesy-landing/",
    },
    {
      label: "Having trouble? Reach out",
      description: "I'd love to help!",
      icon: "popup/icons/feedback.svg",
      hoverColor: "#e8453c",
      url: "mailto:builtbyabin@gmail.com?subject=Sidesy%20Feedback",
    },
    {
      // Firefox port: Chrome Web Store URL replaced with AMO listing.
      label: "Enjoy using? Leave a review",
      description: "Help spread Sidesy to more people",
      icon: "popup/icons/review.svg",
      hoverColor: "#f4b400",
      url: "https://addons.mozilla.org/en-US/firefox/addon/sidesy/",
    },
    {
      label: "Love Sidesy? Buy me a coffee",
      description: "If you're feeling extra generous :)",
      icon: "popup/icons/donate.svg",
      hoverColor: "#34a853",
      url: "https://buymeacoffee.com/abin.john",
    },
    // Firefox port: Conduktor entry omitted (Chrome-only for now).
  ],
  ANNOUNCEMENT: {
    items: [
      "Full-height sidebar\nSwitch comments to full height from the new header button, or by pressing Z when comments are on the side. Press again to go back to standard height. Handy on smaller screens — thanks to everyone who asked for this!",
      "Fold comments away\nPress X or the new header button to fold comments into a slim bar, then click the bar (or press X again) to unfold. Prefer it folded? Turn on Fold comments by default in Settings — it applies to new videos.",
    ],
  },
  DEVELOPER_MESSAGE: {
    // Firefox port: disabled — current campaign promotes Conduktor (Chrome-only).
    // Re-enable with Firefox-appropriate copy/URL when ready.
    enabled: false,
    id: "conduktor-2026-05",
    title: "Hi, it's Abin from Sidesy",
    bodyParagraphs: [
      "I just launched a new extension called Conduktor, a Spotlight-style launcher for Chrome.",
      "Search tabs, manage tab groups, and run browser actions without leaving the keyboard. Built for keyboard-first users, productivity geeks, and tab hoarders.",
      "Free to start. No account or credit card needed. 🙂",
    ],
    ctaLabel: "Check it out",
    remindLabel: "Remind later",
    dismissLabel: "Discard",
    url: "https://chromewebstore.google.com/detail/conduktor-search-rename-g/ppemfnloahkomglmckngiioogeibdbdh",
    existingUserDelayDays: 3,
    newUserDelayDays: 14,
    remindLaterDays: 14,
    maxReminders: 1,
    showDelayMs: 6500,
  },
};
