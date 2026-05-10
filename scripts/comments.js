/*
YouTube is a Single Page Application (SPA). Instead of relying on
messages from the background script (which causes race conditions),
we listen for YouTube's own `yt-navigate-finish` event to detect
page navigation and then watch for comments to become ready.
*/

const TOGGLE_BTN_ID = 'sidesy-toggle-btn';

// State for the current navigation
let currentObserver = null;
let currentInterval = null;
let activated = false;

// Listen for keyboard shortcut messages from the background script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'toggle-sidebar') {
    const popButton = document.getElementById(TOGGLE_BTN_ID);
    if (popButton) popButton.click();
  }
});

const WATCH_PAGE_PATTERN = 'youtube.com/watch';
const ANNOUNCEMENT_TOAST_ID = 'sidesy-announcement';
const DEVELOPER_MESSAGE_TOAST_ID = 'sidesy-developer-message';
const DAY_MS = 24 * 60 * 60 * 1000;

function isMacPlatform() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  return /Mac|iPod|iPhone|iPad/i.test(platform);
}

function getToggleShortcut() {
  return isMacPlatform() ? '⌥\u2002S' : 'Alt\u2002+\u2002S';
}

function isWatchPageUrl() {
  return location.href.includes(WATCH_PAGE_PATTERN);
}

function removeAnnouncementToast() {
  const banner = document.getElementById(ANNOUNCEMENT_TOAST_ID);
  if (banner) banner.remove();
}

function removeDeveloperMessageToast() {
  const toast = document.getElementById(DEVELOPER_MESSAGE_TOAST_ID);
  if (toast) toast.remove();
}

function cleanup() {
  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
  }
  if (currentInterval) {
    clearInterval(currentInterval);
    currentInterval = null;
  }
  activated = false;
}

function areCommentsReady() {
  const comments = document.getElementById('comments');
  return comments &&
         !comments.hasAttribute('hidden') &&
         comments.innerHTML.length > 100;
}

function tryActivate() {
  if (activated) return true;
  if (areCommentsReady()) {
    activated = true;
    activateExtension();
    // Clean up detection mechanisms since we've activated
    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }
    if (currentInterval) {
      clearInterval(currentInterval);
      currentInterval = null;
    }
    return true;
  }
  return false;
}

function detectComments() {
  // Already ready? Activate immediately
  if (tryActivate()) return;

  const comments = document.getElementById('comments');

  // Tier 1: If #comments exists with hidden attribute, observe for unhide
  if (comments && comments.hasAttribute('hidden')) {
    currentObserver = new MutationObserver(() => {
      if (!comments.hasAttribute('hidden')) {
        currentObserver.disconnect();
        currentObserver = null;
        // Content may not be loaded yet — fall through to periodic check
        if (!tryActivate()) {
          startPeriodicCheck();
        }
      }
    });
    currentObserver.observe(comments, { attributes: true, attributeFilter: ['hidden'] });
  }

  // Tier 2: Periodic fallback check
  startPeriodicCheck();
}

function startPeriodicCheck() {
  // Don't start a second interval if one is already running
  if (currentInterval) return;

  let attempts = 0;
  const maxAttempts = 60; // 30 seconds at 500ms intervals

  currentInterval = setInterval(() => {
    attempts++;
    if (tryActivate() || attempts >= maxAttempts) {
      clearInterval(currentInterval);
      currentInterval = null;
    }
  }, 500);
}

function onNavigate() {
  const isWatchPage = isWatchPageUrl();

  cleanup();

  if (!isWatchPage) {
    removeAnnouncementToast();
    removeDeveloperMessageToast();
    return;
  }

  detectComments();
}

// YouTube fires this event when SPA navigation completes
document.addEventListener('yt-navigate-finish', onNavigate);

// Also handle the initial page load (e.g. direct URL paste or refresh)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (isWatchPageUrl()) {
      cleanup();
      detectComments();
    }
  });
} else if (isWatchPageUrl()) {
  detectComments();
}

/*
Save current extension position locally
*/

function savePosition(position) {
  chrome.storage.local.set({ comments_placement: position });
}

/*
Shows a dismissable "What's New" banner inside the sidebar view
if there is a pending announcement in storage.
*/
function maybeShowAnnouncement(isDark) {
  if (!isWatchPageUrl()) return;

  chrome.storage.local.get(["pending_announcement"]).then((data) => {
    if (!isWatchPageUrl()) return;

    const version = data.pending_announcement;
    if (!version) return;

    const items = CONSTANTS.ANNOUNCEMENT.items;
    if (!items || items.length === 0) return;

    // Guard against duplicate injection
    if (document.getElementById(ANNOUNCEMENT_TOAST_ID)) return;

    const banner = document.createElement('div');
    banner.id = ANNOUNCEMENT_TOAST_ID;
    banner.classList.add('sidesy-announcement', isDark ? 'dark-mode' : 'light-mode');

    const titleRow = document.createElement('div');
    titleRow.classList.add('sidesy-announcement-title');

    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('images/sidesy-128.png');
    icon.classList.add('sidesy-announcement-icon');

    const heading = document.createElement('span');
    heading.textContent = "What's New in Sidesy";

    const dismissBtn = document.createElement('button');
    dismissBtn.classList.add('sidesy-announcement-dismiss');
    dismissBtn.setAttribute('aria-label', 'Dismiss announcement');
    const dismissIcon = document.createElement('img');
    dismissIcon.src = chrome.runtime.getURL('images/close.svg');
    dismissIcon.classList.add('sidesy-announcement-dismiss-icon');
    dismissBtn.append(dismissIcon);
    dismissBtn.addEventListener('click', () => {
      chrome.storage.local.set({
        last_seen_announcement: version,
        pending_announcement: null,
      });
      banner.classList.add('sidesy-slide-out');
      banner.addEventListener('animationend', () => banner.remove(), { once: true });
    });

    titleRow.append(icon, heading, dismissBtn);

    const list = document.createElement('ul');
    list.classList.add('sidesy-announcement-list');
    const shortcutLabel = getToggleShortcut();
    
    for (const rawItem of items) {
      const item = rawItem.replace('{{TOGGLE_SHORTCUT}}', shortcutLabel);
      const li = document.createElement('li');
      const [title, ...rest] = item.split('\n');
      const titleEl = document.createElement('strong');
      titleEl.textContent = title;
      li.append(titleEl);
      if (rest.length > 0) {
        li.append(document.createElement('br'));
        li.append(document.createTextNode(rest.join(' ')));
      }
      list.append(li);
    }

    banner.append(titleRow, list);

    document.body.append(banner);
  });
}

function getDeveloperMessageConfig() {
  const config = CONSTANTS.DEVELOPER_MESSAGE;
  if (!config?.enabled) return null;
  if (!config.id || !config.title || !config.url) return null;
  if (!Array.isArray(config.bodyParagraphs) || config.bodyParagraphs.length === 0) {
    return null;
  }
  if (!Number.isFinite(config.existingUserDelayDays)) return null;
  if (!Number.isFinite(config.newUserDelayDays)) return null;
  if (!Number.isFinite(config.remindLaterDays)) return null;
  if (!Number.isFinite(config.maxReminders)) return null;
  if (!Number.isFinite(config.showDelayMs)) return null;
  return config;
}

function createDeveloperMessageState(config, now) {
  return {
    campaignId: config.id,
    firstSeenAt: now,
    dismissedAt: null,
    clickedAt: null,
    remindAfter: null,
    reminderCount: 0,
  };
}

function getDeveloperMessageState(config, rawState, now) {
  if (rawState?.campaignId === config.id && Number.isFinite(rawState.firstSeenAt)) {
    return rawState;
  }

  return createDeveloperMessageState(config, now);
}

function isDeveloperMessageEligible(config, state, installedAt, pendingAnnouncement, now) {
  if (pendingAnnouncement) return false;
  if (state.dismissedAt || state.clickedAt) return false;
  if (state.remindAfter && now < state.remindAfter) return false;

  const installTime = Number(installedAt);
  const delayDays = Number.isFinite(installTime)
    ? config.newUserDelayDays
    : config.existingUserDelayDays;
  const baseTime = Number.isFinite(installTime) ? installTime : state.firstSeenAt;
  const eligibleAt = baseTime + delayDays * DAY_MS;

  return now >= eligibleAt;
}

function dismissDeveloperMessage(toast, state, extraState = {}) {
  chrome.storage.local.set({
    developer_message_state: {
      ...state,
      ...extraState,
    },
  });

  toast.classList.add('sidesy-slide-out');
  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

function renderDeveloperMessage(isDark, config, state) {
  if (!isWatchPageUrl()) return;
  if (document.getElementById(DEVELOPER_MESSAGE_TOAST_ID)) return;
  if (document.getElementById(ANNOUNCEMENT_TOAST_ID)) return;

  const toast = document.createElement('div');
  toast.id = DEVELOPER_MESSAGE_TOAST_ID;
  toast.classList.add('sidesy-developer-message', isDark ? 'dark-mode' : 'light-mode');

  const titleRow = document.createElement('div');
  titleRow.classList.add('sidesy-developer-message-title');

  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('images/sidesy-128.png');
  icon.classList.add('sidesy-developer-message-icon');

  const titleText = document.createElement('span');
  titleText.textContent = config.title;

  titleRow.append(icon, titleText);

  const body = document.createElement('div');
  body.classList.add('sidesy-developer-message-body');

  config.bodyParagraphs.forEach((paragraph) => {
    const text = String(paragraph).trim();
    if (!text) return;

    const bodyParagraph = document.createElement('p');
    bodyParagraph.textContent = text;
    body.append(bodyParagraph);
  });

  const actions = document.createElement('div');
  actions.classList.add('sidesy-developer-message-actions');

  const discard = document.createElement('button');
  discard.classList.add('sidesy-developer-message-discard');
  discard.textContent = config.dismissLabel;
  discard.addEventListener('click', () => {
    dismissDeveloperMessage(toast, state, { dismissedAt: Date.now() });
  });
  actions.append(discard);

  const cta = document.createElement('button');
  cta.classList.add('sidesy-developer-message-cta');
  cta.textContent = config.ctaLabel;
  cta.addEventListener('click', () => {
    dismissDeveloperMessage(toast, state, { clickedAt: Date.now() });
    window.open(config.url, '_blank', 'noopener,noreferrer');
  });

  const canRemindLater = (state.reminderCount || 0) < config.maxReminders;
  if (canRemindLater) {
    const remind = document.createElement('button');
    remind.classList.add('sidesy-developer-message-remind');
    remind.textContent = config.remindLabel;
    remind.addEventListener('click', () => {
      const now = Date.now();
      dismissDeveloperMessage(toast, state, {
        remindAfter: now + config.remindLaterDays * DAY_MS,
        reminderCount: (state.reminderCount || 0) + 1,
      });
    });
    actions.append(remind);
  }

  actions.append(cta);

  toast.append(titleRow, body, actions);
  document.body.append(toast);
}

function maybeShowDeveloperMessage(isDark) {
  const config = getDeveloperMessageConfig();
  if (!config || !isWatchPageUrl()) return;

  window.setTimeout(() => {
    if (!isWatchPageUrl()) return;

    chrome.storage.local.get([
      'developer_message_state',
      'extension_installed_at',
      'pending_announcement',
    ]).then((data) => {
      if (!isWatchPageUrl()) return;

      const now = Date.now();
      const state = getDeveloperMessageState(config, data.developer_message_state, now);

      if (state !== data.developer_message_state) {
        chrome.storage.local.set({ developer_message_state: state });
      }

      if (!isDeveloperMessageEligible(
        config,
        state,
        data.extension_installed_at,
        data.pending_announcement,
        now
      )) {
        return;
      }

      renderDeveloperMessage(isDark, config, state);
    }).catch(() => {});
  }, config.showDelayMs);
}

/*
Gathers info from the page, like the theme and DOM Tree.
A button is then added to the comments section to toggle between
default view and sidebar view, and event listeners are attached.
*/

function activateExtension() {
  const commentsEl = document.querySelector('#comments');
  const page = document.querySelector('html');
  const player = document.querySelector('.video-stream.html5-main-video');
  const originalCommentsContainer = document.querySelector('#below');
  const sidebar = document.querySelector('#secondary-inner');
  const videoSizeButton = document.querySelector('.ytp-size-button');

  let boolTheaterMode = videoSizeButton
    .getAttribute('data-title-no-tooltip')
    .includes('Default');

  const isDark = page.hasAttribute('dark');
  commentsEl.classList.add('extension-control');

  const shortcutKey = getToggleShortcut();

  const popButton = document.createElement('button');
  popButton.id = TOGGLE_BTN_ID;
  popButton.classList.add('comments-header-btn');

  const iconContainer = document.createElement('span');
  popButton.appendChild(iconContainer);

  const tooltip = document.createElement('span');
  tooltip.classList.add('sidesy-tooltip');
  popButton.appendChild(tooltip);

  function isSidebarMode() {
    return commentsEl.classList.contains('popout');
  }

  function getActiveViewport(mode) {
    if (mode === 'sidebar') {
      const rect = commentsEl.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
    return { top: 0, bottom: window.innerHeight };
  }

  // Returns the comment thread currently rendered at a viewport point.
  // We use this for fast anchor detection instead of scanning all threads.
  function findThreadFromPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      const thread = el.closest?.('ytd-comment-thread-renderer');
      if (thread && commentsEl.contains(thread)) return thread;
    }
    return null;
  }

  // Finds the top-most visible comment thread by sampling a few points
  // from top to bottom of the active viewport/container.
  function findTopVisibleThread(mode) {
    const { top, bottom } = getActiveViewport(mode);
    const rect = commentsEl.getBoundingClientRect();
    // Keep sample points away from viewport edges where sticky headers/overlays
    // can interfere. `8` is the screen edge gutter, `16` avoids left UI chrome.
    const sampleX = Math.max(
      8,
      Math.min(window.innerWidth - 8, rect.left + Math.max(rect.width / 2, 16))
    );
    // `12` px top/bottom inset avoids boundary flicker around container edges.
    const startY = Math.max(0, Math.min(window.innerHeight - 1, top + 12));
    const endY = Math.max(0, Math.min(window.innerHeight - 1, bottom - 12));
    // 6 samples balance accuracy and toggle-time performance on long comment lists.
    const steps = 6;

    for (let i = 0; i < steps; i += 1) {
      const ratio = steps === 1 ? 0 : i / (steps - 1);
      const y = startY + (endY - startY) * ratio;
      const thread = findThreadFromPoint(sampleX, y);
      if (thread) return thread;
    }
    return null;
  }

  function captureTopCommentAnchor() {
    const mode = isSidebarMode() ? 'sidebar' : 'default';
    const { top } = getActiveViewport(mode);
    const anchor = findTopVisibleThread(mode);
    if (!anchor) return null;

    return {
      element: anchor,
      offset: anchor.getBoundingClientRect().top - top,
    };
  }

  function getAnchorDelta(anchor, mode) {
    if (!anchor) return;

    let anchorEl = anchor.element;
    if (!anchorEl || !anchorEl.isConnected) return null;

    const { top } = getActiveViewport(mode);
    const currentTop = anchorEl.getBoundingClientRect().top;
    const targetTop = top + anchor.offset;
    const delta = currentTop - targetTop;
    if (Math.abs(delta) < 1) return 0;
    return delta;
  }

  function restoreTopCommentAnchor(anchor, mode) {
    const delta = getAnchorDelta(anchor, mode);
    if (delta === null || delta === 0) return;

    if (mode === 'sidebar') {
      commentsEl.scrollTop += delta;
      return;
    }

    window.scrollBy({ top: delta, behavior: 'auto' });
  }

  function updateTooltip(text) {
    tooltip.innerHTML = `${text} <span class="sidesy-tooltip-key">${shortcutKey}</span>`;
  }

  function defaultView() {
    commentsEl.style.display = 'none';
    commentsEl.classList.remove('popout', 'dark-mode', 'light-mode');
    commentsEl.style.height = 'auto';

    updateTooltip('Show comments in sidebar');
    iconContainer.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="comments-icon ${
        isDark ? 'stroke-light' : 'stroke-dark'
      }">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12.75 15l3-3m0 0l-3-3m3 3h-7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>`;

    originalCommentsContainer.append(commentsEl);
    commentsEl.style.display = 'block';

    savePosition('default');
  }

  function sidebarView() {
    if (boolTheaterMode) {
      videoSizeButton.click();
    }
    commentsEl.classList.add('popout', isDark ? 'dark-mode' : 'light-mode');
    commentsEl.style.height = `${player.offsetHeight}px`;
    requestAnimationFrame(() => {
      commentsEl.style.height = `${player.offsetHeight}px`;
    });

    updateTooltip('Show comments below video');
    iconContainer.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="comments-icon ${
      isDark ? 'stroke-light' : 'stroke-dark'
    }">
      <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 9l-3 3m0 0l3 3m-3-3h7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>`;

    sidebar.prepend(commentsEl);

    savePosition('sidebar');
  }

  function switchMode(targetMode, preserveAnchor = true) {
    const anchor = preserveAnchor ? captureTopCommentAnchor() : null;

    if (targetMode === 'sidebar') sidebarView();
    else defaultView();

    if (targetMode === 'sidebar') {
      page.scrollIntoView({ behavior: 'smooth' });
      if (!anchor) return;
      requestAnimationFrame(() => {
        restoreTopCommentAnchor(anchor, 'sidebar');
      });
      return;
    }

    if (!anchor) return;

    requestAnimationFrame(() => {
      restoreTopCommentAnchor(anchor, targetMode);
    });
  }

  function handleToggleClick() {
    switchMode(isSidebarMode() ? 'default' : 'sidebar');
  }

  if (!commentsEl.querySelector('header')) {
    const header = document.createElement('header');
    header.classList.add('comments-header');
    header.append(popButton);
    commentsEl.prepend(header);
  }

  videoSizeButton.addEventListener('click', () => {
    boolTheaterMode = !boolTheaterMode;

    if (boolTheaterMode && isSidebarMode()) {
      switchMode('default');
    }
  });
  popButton.addEventListener('click', handleToggleClick);

  chrome.storage.local.get(['comments_placement']).then((data) => {
    if (data.comments_placement === 'default') defaultView();
    else sidebarView();
  });

  maybeShowAnnouncement(isDark);
  maybeShowDeveloperMessage(isDark);
}
