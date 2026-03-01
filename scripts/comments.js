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
function triggerSidebarToggle() {
  const popButton = document.getElementById(TOGGLE_BTN_ID);
  if (popButton) popButton.click();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'toggle-sidebar') {
    triggerSidebarToggle();
  }
});

// Firefox may not always apply `commands` bindings as expected.
// Keep a local fallback shortcut handler for Alt/Option + Shift + S.
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const isEditable = target &&
    (target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT');

  if (isEditable) return;

  const isShortcut = event.altKey &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.code === 'KeyS';

  if (isShortcut) {
    event.preventDefault();
    triggerSidebarToggle();
  }
});

const WATCH_PAGE_PATTERN = 'youtube.com/watch';
const ANNOUNCEMENT_TOAST_ID = 'sidesy-announcement';

function isWatchPageUrl() {
  return location.href.includes(WATCH_PAGE_PATTERN);
}

function removeAnnouncementToast() {
  const banner = document.getElementById(ANNOUNCEMENT_TOAST_ID);
  if (banner) banner.remove();
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
    for (const item of items) {
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

  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  const isMac = /Mac|iPod|iPhone|iPad/i.test(platform);
  const shortcutKey = isMac
    ? '⌥\u2002+\u2002⇧\u2002+\u2002S'
    : 'Alt\u2002+\u2002Shift\u2002+\u2002S';

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
}
