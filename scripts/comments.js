/*
YouTube is a Single Page Application (SPA). Instead of relying on
messages from the background script (which causes race conditions),
we listen for YouTube's own `yt-navigate-finish` event to detect
page navigation and then watch for comments to become ready.
*/

const TOGGLE_BTN_ID = 'sidesy-toggle-btn';
const EXPAND_COMMENTS_BTN_ID = 'sidesy-expand-comments-btn';
const EXPAND_COMMENTS_SHORTCUT = 'Z';
const COLLAPSE_COMMENTS_BTN_ID = 'sidesy-collapse-comments-btn';
const COLLAPSE_COMMENTS_SHORTCUT = 'X';
const SIDESY_COLLAPSED_HEIGHT = 104;
const COLLAPSE_DEFAULT_STORAGE_KEY = 'sidesy_collapse_by_default';
const COLLAPSED_STATE_STORAGE_KEY = 'sidebar_comments_collapsed';
const COLLAPSED_VIDEO_STORAGE_KEY = 'sidebar_comments_collapsed_video';
const SIDEBAR_BOTTOM_PADDING = 24;
const SIDEBAR_MIN_EXPANDED_HEIGHT = 240;
// Firefox port: `browser` (promise-based) with `chrome` fallback.
const ext = globalThis.browser ?? globalThis.chrome;
const MAC_SHORTCUT_ICON_URLS = {
  command: ext.runtime.getURL('images/shortcut-icons/cmd.svg'),
  control: ext.runtime.getURL('images/shortcut-icons/control.svg'),
  option: ext.runtime.getURL('images/shortcut-icons/option-icon.svg'),
  shift: ext.runtime.getURL('images/shortcut-icons/shift.svg'),
};

// State for the current navigation
let currentObserver = null;
let currentInterval = null;
let activeExtensionCleanup = null;
let activated = false;
// Fullscreen can orphan the activation's closure (YouTube replaces #comments
// during the transition). Stash a raw scroll position here so the fresh
// activation for the *same* video can best-effort restore it. The videoId
// guard prevents carrying scroll across different videos.
let pendingFullscreenScroll = null;

// Listen for keyboard shortcut messages from the background script
let lastSidebarToggleAt = 0;
function triggerSidebarToggle() {
  // Debounce: the native `commands` message and the in-page fallback below
  // can both fire for one keypress in Firefox — ignore the duplicate.
  const now = Date.now();
  if (now - lastSidebarToggleAt < 400) return;
  lastSidebarToggleAt = now;
  const popButton = document.getElementById(TOGGLE_BTN_ID);
  if (popButton) popButton.click();
}
ext.runtime.onMessage.addListener((message) => {
  if (message.action === 'toggle-sidebar') {
    triggerSidebarToggle();
  }
});

// Firefox port: in-page fallback for Alt+Shift+S (and Alt+S for users coming
// from Chrome). Firefox does not always deliver `commands` to the active tab
// (e.g. customized/unbound shortcut), so handle it locally too.
document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.repeat) return;
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code !== 'KeyS') return;
  if (isEditableTarget(event.target)) return;
  event.preventDefault();
  triggerSidebarToggle();
});

const WATCH_PAGE_PATTERN = 'youtube.com/watch';
const ANNOUNCEMENT_TOAST_ID = 'sidesy-announcement';
const DEVELOPER_MESSAGE_TOAST_ID = 'sidesy-developer-message';
const DAY_MS = 24 * 60 * 60 * 1000;

function isMacPlatform() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  return /Mac|iPod|iPhone|iPad/i.test(platform);
}

function getDefaultShortcutLabel() {
  return isMacPlatform() ? '⌥S' : 'Alt\u2002+\u2002S';
}

function normalizeShortcutPart(part) {
  const normalizedPart = part.trim().toLowerCase();

  if (normalizedPart === 'command' || normalizedPart === 'cmd' || normalizedPart === 'meta') {
    return { type: 'modifier', value: 'command' };
  }

  if (normalizedPart === 'macctrl' || normalizedPart === 'ctrl' || normalizedPart === 'control') {
    return { type: 'modifier', value: 'control' };
  }

  if (normalizedPart === 'alt' || normalizedPart === 'option') {
    return { type: 'modifier', value: 'option' };
  }

  if (normalizedPart === 'shift') {
    return { type: 'modifier', value: 'shift' };
  }

  return { type: 'key', value: part.trim().toUpperCase() };
}

function parseShortcut(shortcut) {
  return shortcut
    .split('+')
    .map(normalizeShortcutPart)
    .filter(({ value }) => value.length > 0);
}

function formatShortcutText(shortcut) {
  return shortcut.replace(/\+/g, '\u2002+\u2002');
}

function createMacShortcutBadge(shortcut) {
  const shortcutBadge = document.createElement('span');
  shortcutBadge.classList.add('sidesy-tooltip-key', 'sidesy-tooltip-key-mac');

  for (const part of parseShortcut(shortcut)) {
    if (part.type === 'modifier') {
      const icon = document.createElement('span');
      icon.classList.add('sidesy-tooltip-key-icon');
      icon.style.setProperty('--sidesy-shortcut-icon', `url("${MAC_SHORTCUT_ICON_URLS[part.value]}")`);
      shortcutBadge.append(icon);
      continue;
    }

    const token = document.createElement('span');
    token.classList.add('sidesy-tooltip-key-token');
    token.textContent = part.value;
    shortcutBadge.append(token);
  }

  return shortcutBadge;
}

function createShortcutBadge(shortcut) {
  if (isMacPlatform()) {
    return createMacShortcutBadge(shortcut);
  }

  const shortcutBadge = document.createElement('span');
  shortcutBadge.classList.add('sidesy-tooltip-key');
  shortcutBadge.textContent = formatShortcutText(shortcut);
  return shortcutBadge;
}

async function getToggleShortcutInfo() {
  try {
    return await ext.runtime.sendMessage({
      action: 'get-toggle-shortcut-info',
    });
  } catch {
    return {
      shortcut: '',
      isRegistered: false,
    };
  }
}

function isWatchPageUrl() {
  return location.href.includes(WATCH_PAGE_PATTERN);
}

function getCurrentVideoId() {
  try {
    return new URLSearchParams(location.search).get('v');
  } catch {
    return null;
  }
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;

  if (target.closest('input, textarea, select')) return true;

  const contentEditable = target.closest('[contenteditable]');
  return Boolean(
    contentEditable &&
    contentEditable.getAttribute('contenteditable')?.toLowerCase() !== 'false'
  );
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
  if (activeExtensionCleanup) {
    activeExtensionCleanup();
    activeExtensionCleanup = null;
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
  ext.storage.local.set({ comments_placement: position });
}

function saveSidebarExpanded(isExpanded) {
  ext.storage.local.set({ sidebar_comments_expanded: isExpanded });
}

/*
Shows a dismissable "What's New" banner inside the sidebar view
if there is a pending announcement in storage.
*/
function maybeShowAnnouncement(isDark) {
  if (!isWatchPageUrl()) return;

  ext.storage.local.get(["pending_announcement"]).then((data) => {
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
    icon.src = ext.runtime.getURL('images/sidesy-128.png');
    icon.classList.add('sidesy-announcement-icon');

    const heading = document.createElement('span');
    heading.textContent = "What's New in Sidesy";

    const dismissBtn = document.createElement('button');
    dismissBtn.classList.add('sidesy-announcement-dismiss');
    dismissBtn.setAttribute('aria-label', 'Dismiss announcement');
    const dismissIcon = document.createElement('img');
    dismissIcon.src = ext.runtime.getURL('images/close.svg');
    dismissIcon.classList.add('sidesy-announcement-dismiss-icon');
    dismissBtn.append(dismissIcon);
    dismissBtn.addEventListener('click', () => {
      ext.storage.local.set({
        last_seen_announcement: version,
        pending_announcement: null,
      });
      banner.classList.add('sidesy-slide-out');
      banner.addEventListener('animationend', () => banner.remove(), { once: true });
    });

    titleRow.append(icon, heading, dismissBtn);

    const list = document.createElement('ul');
    list.classList.add('sidesy-announcement-list');
    const shortcutLabel = getDefaultShortcutLabel();
    
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
  ext.storage.local.set({
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
  icon.src = ext.runtime.getURL('images/sidesy-128.png');
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

    ext.storage.local.get([
      'developer_message_state',
      'extension_installed_at',
      'pending_announcement',
    ]).then((data) => {
      if (!isWatchPageUrl()) return;

      const now = Date.now();
      const state = getDeveloperMessageState(config, data.developer_message_state, now);

      if (state !== data.developer_message_state) {
        ext.storage.local.set({ developer_message_state: state });
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
    ?.getAttribute('data-title-no-tooltip')
    ?.includes('Default') ?? false;

  const isDark = page.hasAttribute('dark');
  commentsEl.classList.add('extension-control');

  const existingHeader = commentsEl.querySelector(':scope > .comments-header');
  if (existingHeader) existingHeader.remove();
  // Drop any stale folded placeholder from a previous navigation: its
  // click listener closes over the old activation's fold state.
  const staleNotice = commentsEl.querySelector(':scope > .sidesy-collapsed-notice');
  if (staleNotice) staleNotice.remove();
  commentsEl.classList.remove('sidesy-collapsed');

  const popButton = document.createElement('button');
  popButton.id = TOGGLE_BTN_ID;
  popButton.classList.add('comments-header-btn');
  popButton.type = 'button';

  const iconContainer = document.createElement('span');
  popButton.appendChild(iconContainer);

  const tooltip = document.createElement('span');
  tooltip.classList.add('sidesy-tooltip');
  popButton.appendChild(tooltip);

  const expandCommentsButton = document.createElement('button');
  expandCommentsButton.id = EXPAND_COMMENTS_BTN_ID;
  expandCommentsButton.classList.add('comments-header-btn', 'sidesy-expand-comments-btn');
  expandCommentsButton.type = 'button';

  const expandCommentsIcon = document.createElement('span');
  expandCommentsIcon.classList.add('sidesy-expand-comments-icon');
  expandCommentsButton.appendChild(expandCommentsIcon);

  const expandCommentsTooltip = document.createElement('span');
  expandCommentsTooltip.classList.add('sidesy-tooltip');
  expandCommentsButton.appendChild(expandCommentsTooltip);

  const collapseCommentsButton = document.createElement('button');
  collapseCommentsButton.id = COLLAPSE_COMMENTS_BTN_ID;
  collapseCommentsButton.classList.add('comments-header-btn', 'sidesy-collapse-comments-btn');
  collapseCommentsButton.type = 'button';

  const collapseCommentsIcon = document.createElement('span');
  collapseCommentsIcon.classList.add('sidesy-collapse-comments-icon');
  collapseCommentsButton.appendChild(collapseCommentsIcon);

  const collapseCommentsTooltip = document.createElement('span');
  collapseCommentsTooltip.classList.add('sidesy-tooltip');
  collapseCommentsButton.appendChild(collapseCommentsTooltip);

  let isSidebarExpanded = false;
  let sidebarHeightAnimationTimeout = null;
  let isCommentsCollapsed = false;
  let collapseByDefault = false;
  // Scroll position within the sidebar (the "state" users mean when they say
  // fold/fullscreen loses their place). In-memory per video: each video
  // has a different comment set, so this is intentionally not persisted.
  let savedCollapsedScroll = null;
  // Fullscreen hide happens *before* `fullscreenchange` fires, so saving at
  // enter-time is already too late (anchor is null, scrollTop already 0).
  // Instead track the last *visible* position continuously while scrolling.
  let lastVisibleSidebarScroll = null;
  let scrollAnchorDebounce = null;

  function isSidebarMode() {
    return commentsEl.classList.contains('popout');
  }

  function getYouTubeHeaderBottom() {
    const header = document.querySelector('#masthead-container');
    if (!header) return 0;

    return Math.max(0, header.getBoundingClientRect().bottom);
  }

  function getSidebarContentAboveHeight() {
    const sidebarRect = sidebar.getBoundingClientRect();
    const commentsRect = commentsEl.getBoundingClientRect();
    return Math.max(0, commentsRect.top - sidebarRect.top);
  }

  function getSidebarHeight() {
    // Re-query instead of using the activation-time `player` reference:
    // YouTube can swap the video element on fullscreen/quality changes,
    // leaving the captured node detached with a stale offsetHeight.
    const activePlayer = document.querySelector('.video-stream.html5-main-video') || player;
    if (!isSidebarExpanded) return activePlayer ? activePlayer.offsetHeight : SIDESY_COLLAPSED_HEIGHT;

    const expandedHeight = (
      window.innerHeight -
      getYouTubeHeaderBottom() -
      getSidebarContentAboveHeight() -
      SIDEBAR_BOTTOM_PADDING
    );

    return Math.max(SIDEBAR_MIN_EXPANDED_HEIGHT, expandedHeight);
  }

  function updateExpandCommentsButton() {
    const inSidebar = isSidebarMode();
    expandCommentsButton.hidden = !inSidebar;
    // When folded, park the full-height button with visibility (not display) so
    // the fold + toggle buttons never shift position.
    const parked = inSidebar && isCommentsCollapsed;
    expandCommentsButton.classList.toggle('sidesy-btn-parked', parked);
    expandCommentsButton.setAttribute('aria-expanded', String(isSidebarExpanded));

    if (!inSidebar) return;

    const label = isSidebarExpanded ? 'Back to standard height' : 'Switch to full height';
    expandCommentsIcon.innerHTML = getExpandCommentsIconSvg();
    expandCommentsTooltip.textContent = '';
    const textNode = document.createElement('span');
    textNode.textContent = label;
    expandCommentsTooltip.append(textNode, createShortcutBadge(EXPAND_COMMENTS_SHORTCUT));
    expandCommentsButton.setAttribute('aria-label', label);
  }

  function getExpandCommentsIconSvg() {
    if (isSidebarExpanded) {
      return `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="sidesy-expand-comments-svg ${
          isDark ? 'stroke-light' : 'stroke-dark'
        }" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7 5l5 5 5-5M7 19l5-5 5 5" />
        </svg>`;
    }

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="sidesy-expand-comments-svg ${
        isDark ? 'stroke-light' : 'stroke-dark'
      }" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7 10l5-5 5 5M7 14l5 5 5-5" />
      </svg>`;
  }

  function updateCollapseCommentsButton() {
    const isVisible = isSidebarMode();
    collapseCommentsButton.hidden = !isVisible;
    collapseCommentsButton.setAttribute('aria-expanded', String(!isCommentsCollapsed));

    if (!isVisible) return;

    const label = isCommentsCollapsed ? 'Unfold comments' : 'Fold comments away';
    collapseCommentsIcon.innerHTML = getCollapseCommentsIconSvg();
    collapseCommentsTooltip.textContent = '';
    const textNode = document.createElement('span');
    textNode.textContent = label;
    collapseCommentsTooltip.append(textNode, createShortcutBadge(COLLAPSE_COMMENTS_SHORTCUT));
    collapseCommentsButton.setAttribute('aria-label', label);
  }

  function getCollapseCommentsIconSvg() {
    // Bar + chevron motif, rhyming with the full-height button's double chevrons:
    // top bar + down chevron = fold away, bottom bar + up chevron = unfold.
    const path = isCommentsCollapsed ? 'M4 19h16M7 12l5-5 5 5' : 'M4 5h16M7 12l5 5 5-5';
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="sidesy-collapse-comments-svg ${
        isDark ? 'stroke-light' : 'stroke-dark'
      }" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="${path}" />
      </svg>`;
  }

  function ensureCollapsedNotice() {
    let notice = commentsEl.querySelector(':scope > .sidesy-collapsed-notice');
    if (!notice) {
      notice = document.createElement('button');
      notice.type = 'button';
      notice.classList.add('sidesy-collapsed-notice');
      notice.hidden = true;
      const title = document.createElement('span');
      title.classList.add('sidesy-collapsed-notice-title');
      title.textContent = 'Comments folded away';
      const hint = document.createElement('span');
      hint.classList.add('sidesy-collapsed-notice-hint');
      hint.textContent = 'Click or press X to unfold comments';
      notice.append(title, hint);
      notice.addEventListener('click', () => setCommentsCollapsed(false));
      commentsEl.append(notice);
    }
    return notice;
  }

  function saveSidebarCollapsed(isCollapsed) {
    ext.storage.local.set({
      [COLLAPSED_STATE_STORAGE_KEY]: isCollapsed,
      [COLLAPSED_VIDEO_STORAGE_KEY]: getCurrentVideoId(),
    });
  }

  function setCommentsCollapsed(collapsed) {
    if (collapsed && !isSidebarMode()) return;
    // Save scroll *before* mutating DOM: folding hides threads
    // (display:none via CSS) and resets scrollTop to 0 for the slim bar.
    if (collapsed && !isCommentsCollapsed) {
      savedCollapsedScroll = saveSidebarScroll();
    }
    isCommentsCollapsed = collapsed;
    const notice = ensureCollapsedNotice();
    // Dedicated smooth curves (no bounce) — the large height change of the
    // radical fold makes the full-height springy curve look wrong.
    setCollapseHeightAnimation(collapsed);
    if (collapsed) {
      commentsEl.classList.add('sidesy-collapsed');
      commentsEl.style.height = `${SIDESY_COLLAPSED_HEIGHT}px`;
      commentsEl.scrollTop = 0;
      notice.hidden = false;
    } else {
      commentsEl.classList.remove('sidesy-collapsed');
      notice.hidden = true;
      syncSidebarHeight();
      // Restore the pre-fold position (immediate + next-frame pass for
      // the height animation). Consume it so a later full-height change starts fresh.
      const toRestore = savedCollapsedScroll;
      savedCollapsedScroll = null;
      if (toRestore) restoreSidebarScroll(toRestore);
    }
    updateExpandCommentsButton();
    updateCollapseCommentsButton();
    saveSidebarCollapsed(isCommentsCollapsed);
  }

  function syncSidebarHeight() {
    if (!isSidebarMode()) return;

    if (isCommentsCollapsed) {
      // Re-assert (not just update buttons): fullscreen enter/exit and
      // YouTube DOM shuffling can clear the inline height/class while the
      // in-memory flag is still true. Repair it here so resize/fullscreen
      // always converges back to the saved folded bar.
      commentsEl.classList.add('sidesy-collapsed');
      commentsEl.style.height = `${SIDESY_COLLAPSED_HEIGHT}px`;
      const collapsedNotice = commentsEl.querySelector(':scope > .sidesy-collapsed-notice');
      if (collapsedNotice) collapsedNotice.hidden = false;
      updateExpandCommentsButton();
      updateCollapseCommentsButton();
      return;
    }

    // While fullscreen the sidebar is hidden and player metrics reflect the
    // fullscreen video (not the sidebar layout) — defer expanded sizing
    // until fullscreen exits (handled via fullscreenchange below).
    if (document.fullscreenElement) return;

    commentsEl.style.height = `${getSidebarHeight()}px`;
    updateExpandCommentsButton();
    updateCollapseCommentsButton();
  }

  function handleFullscreenChange() {
    // If YouTube replaced #comments during the fullscreen transition, the
    // captured commentsEl/header/buttons are orphaned on a detached node.
    // Stash the last *visible* scroll (not the current, already-clobbered
    // one) for the same video, then rebuild.
    if (document.querySelector('#comments') !== commentsEl || !commentsEl.isConnected) {
      if (isSidebarMode() && !isCommentsCollapsed && lastVisibleSidebarScroll) {
        try {
          pendingFullscreenScroll = {
            videoId: getCurrentVideoId(),
            scrollTop: lastVisibleSidebarScroll.scrollTop,
          };
        } catch { pendingFullscreenScroll = null; }
      }
      onNavigate();
      return;
    }
    if (document.fullscreenElement) {
      // Entering fullscreen: the sidebar is already hidden, so the live
      // scrollTop/anchor are already clobbered (0/null). Do NOT save here —
      // `lastVisibleSidebarScroll` from the scroll tracker holds the true
      // pre-fullscreen position. This late-save was the fullscreen bug.
      return;
    }
    // Exiting fullscreen: re-assert size, then restore the pre-fullscreen
    // position tracked before the sidebar was hidden.
    syncSidebarHeightWithNextFrame();
    if (lastVisibleSidebarScroll) restoreFullscreenScrollWithRetry(lastVisibleSidebarScroll);
  }

  function syncSidebarHeightWithNextFrame() {
    syncSidebarHeight();
    requestAnimationFrame(syncSidebarHeight);
  }

  function setCollapseHeightAnimation(collapsing) {
    commentsEl.classList.remove(
      'sidesy-height-expand', 'sidesy-height-collapse',
      'sidesy-height-expand-smooth', 'sidesy-height-collapse-smooth'
    );
    commentsEl.classList.add(collapsing ? 'sidesy-height-collapse-smooth' : 'sidesy-height-expand-smooth');

    if (sidebarHeightAnimationTimeout) {
      clearTimeout(sidebarHeightAnimationTimeout);
      sidebarHeightAnimationTimeout = null;
    }

    sidebarHeightAnimationTimeout = setTimeout(() => {
      commentsEl.classList.remove('sidesy-height-expand-smooth', 'sidesy-height-collapse-smooth');
      sidebarHeightAnimationTimeout = null;
    }, collapsing ? 300 : 260);
  }

  function setSidebarHeightAnimation(isExpanding) {
    commentsEl.classList.remove(
      'sidesy-height-expand', 'sidesy-height-collapse',
      'sidesy-height-expand-smooth', 'sidesy-height-collapse-smooth'
    );
    commentsEl.classList.add(isExpanding ? 'sidesy-height-expand' : 'sidesy-height-collapse');

    if (sidebarHeightAnimationTimeout) {
      clearTimeout(sidebarHeightAnimationTimeout);
      sidebarHeightAnimationTimeout = null;
    }

    sidebarHeightAnimationTimeout = setTimeout(() => {
      commentsEl.classList.remove('sidesy-height-expand', 'sidesy-height-collapse');
      sidebarHeightAnimationTimeout = null;
    }, isExpanding ? 170 : 260);
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

  function saveSidebarScroll() {
    if (!isSidebarMode()) return null;
    // Must be called while threads are still visible (before fold class
    // or fullscreen hides the sidebar) so anchor detection can see them.
    return {
      anchor: captureTopCommentAnchor(),
      scrollTop: commentsEl.scrollTop,
    };
  }

  function restoreSidebarScroll(saved) {
    if (!saved || !isSidebarMode() || isCommentsCollapsed) return;
    // Anchor survives height changes; raw scrollTop is the fallback when no
    // thread was visible (e.g. scrolled to the very top) or it detached.
    if (saved.anchor?.element?.isConnected) {
      restoreTopCommentAnchor(saved.anchor, 'sidebar');
      // Second pass next frame: height animations/layout settle async.
      requestAnimationFrame(() => {
        if (saved.anchor?.element?.isConnected && isSidebarMode() && !isCommentsCollapsed) {
          restoreTopCommentAnchor(saved.anchor, 'sidebar');
        }
      });
    } else if (typeof saved.scrollTop === 'number') {
      try { commentsEl.scrollTop = saved.scrollTop; } catch {}
      requestAnimationFrame(() => {
        if (isSidebarMode() && !isCommentsCollapsed) {
          try { commentsEl.scrollTop = saved.scrollTop; } catch {}
        }
      });
    }
  }

  function isSidebarVisibleForTracking() {
    if (!isSidebarMode() || isCommentsCollapsed) return false;
    if (document.fullscreenElement) return false;
    if (!commentsEl.isConnected) return false;
    const rect = commentsEl.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function onSidebarScroll() {
    // Never record hidden/clobbered state: while folded, fullscreen, or
    // detached, scrollTop may read 0 — keeping the last visible value.
    if (!isSidebarVisibleForTracking()) return;
    const scrollTop = commentsEl.scrollTop;
    if (lastVisibleSidebarScroll) {
      lastVisibleSidebarScroll.scrollTop = scrollTop;
    } else {
      lastVisibleSidebarScroll = { anchor: null, scrollTop };
    }
    // Anchor capture (elementsFromPoint x6) is too costly per scroll event —
    // refresh it debounced after scrolling settles, while still visible.
    if (scrollAnchorDebounce) clearTimeout(scrollAnchorDebounce);
    scrollAnchorDebounce = setTimeout(() => {
      scrollAnchorDebounce = null;
      if (!isSidebarVisibleForTracking()) return;
      const anchor = captureTopCommentAnchor();
      if (lastVisibleSidebarScroll) {
        lastVisibleSidebarScroll.anchor = anchor;
        lastVisibleSidebarScroll.scrollTop = commentsEl.scrollTop;
      } else {
        lastVisibleSidebarScroll = { anchor, scrollTop: commentsEl.scrollTop };
      }
    }, 200);
  }

  function restoreFullscreenScrollWithRetry(saved) {
    if (!saved) return;
    restoreSidebarScroll(saved);
    // Continuations may still be settling after exit; one guarded retry in
    // case the first restore clamped. Only retries when still at the top so
    // it never yanks the user back after they intentionally scrolled.
    const target = typeof saved.scrollTop === 'number' ? saved.scrollTop : null;
    setTimeout(() => {
      if (!isSidebarMode() || isCommentsCollapsed) return;
      if (target !== null && target > 2 && commentsEl.scrollTop <= 2) {
        restoreSidebarScroll(saved);
      }
    }, 350);
  }

  function updateTooltip(text, shortcutInfo) {
    tooltip.textContent = '';

    const textNode = document.createElement('span');
    textNode.textContent = text;
    tooltip.append(textNode);

    if (shortcutInfo?.isRegistered && shortcutInfo.shortcut) {
      tooltip.append(createShortcutBadge(shortcutInfo.shortcut));
    }
  }

  function getTooltipText() {
    return isSidebarMode() ? 'Show comments below video' : 'Show comments in sidebar';
  }

  function syncAndRenderTooltip() {
    getToggleShortcutInfo().then((shortcutInfo) => {
      updateTooltip(getTooltipText(), shortcutInfo);
    });
  }

  function defaultView() {
    commentsEl.style.display = 'none';
    commentsEl.classList.remove('popout', 'dark-mode', 'light-mode');
    commentsEl.classList.remove('sidesy-collapsed');
    const collapsedNotice = commentsEl.querySelector(':scope > .sidesy-collapsed-notice');
    if (collapsedNotice) collapsedNotice.hidden = true;
    commentsEl.style.height = 'auto';
    updateExpandCommentsButton();
    updateCollapseCommentsButton();
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
      videoSizeButton?.click();
    }
    commentsEl.classList.add('popout', isDark ? 'dark-mode' : 'light-mode');
    iconContainer.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="comments-icon ${
      isDark ? 'stroke-light' : 'stroke-dark'
    }">
      <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 9l-3 3m0 0l3 3m-3-3h7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>`;

    sidebar.prepend(commentsEl);
    if (isCommentsCollapsed) {
      const notice = ensureCollapsedNotice();
      commentsEl.classList.add('sidesy-collapsed');
      commentsEl.style.height = `${SIDESY_COLLAPSED_HEIGHT}px`;
      commentsEl.scrollTop = 0;
      notice.hidden = false;
      updateExpandCommentsButton();
      updateCollapseCommentsButton();
    } else {
      syncSidebarHeightWithNextFrame();
      updateCollapseCommentsButton();
    }

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

  function handleExpandCommentsClick() {
    const willExpand = !isSidebarExpanded;
    setSidebarHeightAnimation(willExpand);
    isSidebarExpanded = willExpand;
    syncSidebarHeight();
    saveSidebarExpanded(isSidebarExpanded);
  }

  function handleExpandCommentsKeydown(event) {
    if (event.defaultPrevented || event.repeat) return;
    if (event.key.toLowerCase() !== 'z') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!isSidebarMode() || isCommentsCollapsed || isEditableTarget(event.target)) return;

    event.preventDefault();
    handleExpandCommentsClick();
  }

  function handleCollapseCommentsClick() {
    setCommentsCollapsed(!isCommentsCollapsed);
  }

  function handleCollapseCommentsKeydown(event) {
    if (event.defaultPrevented || event.repeat) return;
    if (event.key.toLowerCase() !== COLLAPSE_COMMENTS_SHORTCUT.toLowerCase()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!isSidebarMode() || isEditableTarget(event.target)) return;

    event.preventDefault();
    handleCollapseCommentsClick();
  }

  const header = document.createElement('header');
  header.classList.add('comments-header');
  header.append(collapseCommentsButton, expandCommentsButton, popButton);
  commentsEl.prepend(header);

  videoSizeButton?.addEventListener('click', () => {
    boolTheaterMode = !boolTheaterMode;

    if (boolTheaterMode && isSidebarMode()) {
      switchMode('default');
    }
  });
  popButton.addEventListener('click', handleToggleClick);
  popButton.addEventListener('mouseenter', syncAndRenderTooltip);
  expandCommentsButton.addEventListener('click', handleExpandCommentsClick);
  collapseCommentsButton.addEventListener('click', handleCollapseCommentsClick);
  document.addEventListener('keydown', handleExpandCommentsKeydown);
  document.addEventListener('keydown', handleCollapseCommentsKeydown);
  window.addEventListener('resize', syncSidebarHeight);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  commentsEl.addEventListener('scroll', onSidebarScroll, { passive: true });
  activeExtensionCleanup = () => {
    if (sidebarHeightAnimationTimeout) {
      clearTimeout(sidebarHeightAnimationTimeout);
      sidebarHeightAnimationTimeout = null;
    }
    if (scrollAnchorDebounce) {
      clearTimeout(scrollAnchorDebounce);
      scrollAnchorDebounce = null;
    }
    commentsEl.removeEventListener('scroll', onSidebarScroll);
    document.removeEventListener('keydown', handleExpandCommentsKeydown);
    document.removeEventListener('keydown', handleCollapseCommentsKeydown);
    window.removeEventListener('resize', syncSidebarHeight);
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
  };

  ext.storage.local.get(['comments_placement', 'sidebar_comments_expanded', COLLAPSE_DEFAULT_STORAGE_KEY, COLLAPSED_STATE_STORAGE_KEY, COLLAPSED_VIDEO_STORAGE_KEY]).then((data) => {
    isSidebarExpanded = data.sidebar_comments_expanded === true;
    collapseByDefault = data[COLLAPSE_DEFAULT_STORAGE_KEY] === true;
    const savedCollapsed = data[COLLAPSED_STATE_STORAGE_KEY];
    // New videos always start from the "fold by default" preference. The
    // saved fold value is only reused for same-video re-activations
    // (e.g. fullscreen enter/exit replaces #comments and rebuilds from this
    // same init path). Without the video guard, an unfold on one video
    // would leak into the next video and defeat the default.
    const currentVideoId = getCurrentVideoId();
    const storedVideoId = data[COLLAPSED_VIDEO_STORAGE_KEY];
    const isSameVideo = Boolean(currentVideoId) && storedVideoId === currentVideoId;
    const startCollapsed = isSameVideo && typeof savedCollapsed === 'boolean'
      ? savedCollapsed
      : collapseByDefault;
    // Fold only applies visually in the sidebar; keep the flag even in
    // default placement so toggling back to sidebar restores the fold state.
    isCommentsCollapsed = startCollapsed;

    if (data.comments_placement === 'default') {
      defaultView();
    } else {
      sidebarView();
    }
    // Same-video fullscreen rebuild (see handleFullscreenChange): the old
    // thread elements are detached so only a raw scrollTop restore is
    // possible, and only when the video is the same. New videos ignore it.
    if (pendingFullscreenScroll) {
      const pending = pendingFullscreenScroll;
      pendingFullscreenScroll = null;
      try {
        const freshVideoId = getCurrentVideoId();
        if (pending.videoId && pending.videoId === freshVideoId && isSidebarMode() && typeof pending.scrollTop === 'number') {
          if (isCommentsCollapsed) {
            savedCollapsedScroll = { anchor: null, scrollTop: pending.scrollTop };
          } else {
            try { commentsEl.scrollTop = pending.scrollTop; } catch {}
            requestAnimationFrame(() => {
              if (isSidebarMode() && !isCommentsCollapsed) {
                try { commentsEl.scrollTop = pending.scrollTop; } catch {}
              }
            });
          }
        }
      } catch {}
    }
  });

  maybeShowAnnouncement(isDark);
  maybeShowDeveloperMessage(isDark);
}
