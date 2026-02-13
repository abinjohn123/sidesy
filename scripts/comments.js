/*
YouTube is a Single Page Application (SPA). Instead of relying on
messages from the background script (which causes race conditions),
we listen for YouTube's own `yt-navigate-finish` event to detect
page navigation and then watch for comments to become ready.
*/

// State for the current navigation
let currentObserver = null;
let currentInterval = null;
let activated = false;

// Resize state
const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_MAX_WIDTH = 700;
const SIDEBAR_DEFAULT_WIDTH = 426; // YouTube's native #secondary width
let resizeHandle = null;
let isResizing = false;

function cleanup() {
  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
  }
  if (currentInterval) {
    clearInterval(currentInterval);
    currentInterval = null;
  }
  teardownResizeHandle();
  resetSidebarWidth();
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
  const isWatchPage = location.href.includes('youtube.com/watch');

  cleanup();

  if (!isWatchPage) return;

  detectComments();
}

// YouTube fires this event when SPA navigation completes
document.addEventListener('yt-navigate-finish', onNavigate);

// Also handle the initial page load (e.g. direct URL paste or refresh)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (location.href.includes('youtube.com/watch')) {
      cleanup();
      detectComments();
    }
  });
} else if (location.href.includes('youtube.com/watch')) {
  detectComments();
}

/*
Goes through the comments, determines if the number of lines
is more than 4, and displays the 'Read More' button
to expand the comments.
*/

function expandComments(commentsEl) {
  const commentTextContainer = commentsEl.querySelectorAll(
    '#expander.style-scope.ytd-comment-view-model'
  );

  const lineHeight =
    commentTextContainer.length > 0
      ? Number.parseFloat(
          getComputedStyle(
            commentTextContainer[0].querySelector('#content-text')
          ).lineHeight
        )
      : 20;

  function showExpandButton(comment, shouldShow) {
    const btnMore = comment.querySelector('#more');
    const btnLess = comment.querySelector('#less');

    if (!shouldShow) {
      btnMore.setAttribute('hidden', '');
      btnLess.setAttribute('hidden', '');
      return;
    }

    btnLess.setAttribute('hidden', '');
    btnMore.removeAttribute('hidden');
  }

  commentTextContainer.forEach((comment) => {
    comment.querySelector('#content').offsetHeight;
    const textContainerHeight =
      comment.querySelector('#content-text').offsetHeight;
    const lines = Math.ceil(textContainerHeight / lineHeight);
    showExpandButton(comment, lines > 4);
  });
}

/*
Save current extension position locally
*/

function savePosition(position) {
  chrome.storage.local.set({ comments_placement: position });
}

/*
Sidebar width persistence and resize handle
*/

function saveSidebarWidth(width) {
  chrome.storage.local.set({ sidebar_width: width });
}

function loadSidebarWidth() {
  return chrome.storage.local.get(['sidebar_width']).then((data) => {
    return data.sidebar_width || SIDEBAR_DEFAULT_WIDTH;
  });
}

function applySidebarWidth(width) {
  const secondary = document.querySelector('#secondary');
  const primary = document.querySelector('#primary');
  if (!secondary) return;

  const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
  secondary.style.width = clamped + 'px';
  secondary.style.minWidth = clamped + 'px';
  secondary.style.maxWidth = clamped + 'px';

  if (primary) {
    primary.classList.add('sidesy-custom-width');
  }
}

function resetSidebarWidth() {
  const secondary = document.querySelector('#secondary');
  const primary = document.querySelector('#primary');
  if (!secondary) return;

  secondary.style.width = '';
  secondary.style.minWidth = '';
  secondary.style.maxWidth = '';

  if (primary) {
    primary.classList.remove('sidesy-custom-width');
  }
}

function createResizeHandle() {
  const handle = document.createElement('div');
  handle.classList.add('sidesy-resize-handle');
  return handle;
}

function setupResizeHandle() {
  const secondary = document.querySelector('#secondary');
  if (!secondary || resizeHandle) return;

  resizeHandle = createResizeHandle();
  secondary.style.position = 'relative';
  secondary.prepend(resizeHandle);

  resizeHandle.addEventListener('mousedown', onResizeStart);
}

function teardownResizeHandle() {
  if (resizeHandle) {
    resizeHandle.removeEventListener('mousedown', onResizeStart);
    resizeHandle.remove();
    resizeHandle = null;
  }
  if (isResizing) {
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeEnd);
    document.body.classList.remove('sidesy-resizing');
    isResizing = false;
  }

  const secondary = document.querySelector('#secondary');
  if (secondary) {
    secondary.style.position = '';
  }
}

function onResizeStart(e) {
  e.preventDefault();
  isResizing = true;

  resizeHandle.classList.add('dragging');
  document.body.classList.add('sidesy-resizing');

  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
}

function onResizeMove(e) {
  if (!isResizing) return;

  const secondary = document.querySelector('#secondary');
  if (!secondary) return;

  const secondaryRect = secondary.getBoundingClientRect();
  const newWidth = secondaryRect.right - e.clientX;

  applySidebarWidth(newWidth);
}

function onResizeEnd() {
  if (!isResizing) return;
  isResizing = false;

  resizeHandle.classList.remove('dragging');
  document.body.classList.remove('sidesy-resizing');

  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);

  const secondary = document.querySelector('#secondary');
  if (secondary) {
    saveSidebarWidth(Math.round(secondary.getBoundingClientRect().width));
  }
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

  const popButton = document.createElement('button');
  popButton.classList.add('comments-header-btn');

  function defaultView() {
    teardownResizeHandle();
    resetSidebarWidth();

    commentsEl.style.display = 'none';
    commentsEl.classList.remove('popout', 'dark-mode', 'light-mode');
    commentsEl.style.height = 'auto';

    popButton.removeEventListener('click', defaultView);
    popButton.addEventListener('click', sidebarView);

    popButton.innerHTML = `
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
    setTimeout(() => {
      commentsEl.style.height = `${player.offsetHeight}px`;
    }, 0);
    popButton.removeEventListener('click', sidebarView);
    popButton.addEventListener('click', () => {
      defaultView();
      expandComments(commentsEl);
      commentsEl.scrollIntoView({ behavior: 'smooth' });
    });

    popButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="comments-icon ${
      isDark ? 'stroke-light' : 'stroke-dark'
    }">
      <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 9l-3 3m0 0l3 3m-3-3h7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"" />
    </svg>`;

    sidebar.prepend(commentsEl);
    expandComments(commentsEl);
    page.scrollIntoView({ behavior: 'smooth' });

    savePosition('sidebar');

    loadSidebarWidth().then((width) => {
      applySidebarWidth(width);
      setupResizeHandle();
    });
  }

  if (!commentsEl.querySelector('header')) {
    const header = document.createElement('header');
    header.classList.add('comments-header');
    header.append(popButton);
    commentsEl.prepend(header);
  }

  // Click event listener to handle the 'Read More' and 'Show Less' button clicks.
  function handleExpandButtonClick(e) {
    if (
      !e.target.classList.contains('more-button') &&
      !e.target.classList.contains('less-button')
    )
      return;

    const commentContainer = e.target.closest(
      '#expander.style-scope.ytd-comment-view-model'
    );
    const btnMore = commentContainer.querySelector('#more');
    const btnLess = commentContainer.querySelector('#less');

    if (e.target.classList.contains('more-button')) {
      btnMore.setAttribute('hidden', '');
      btnLess.removeAttribute('hidden');
      commentContainer.removeAttribute('collapsed');
    } else {
      btnMore.removeAttribute('hidden');
      btnLess.setAttribute('hidden', '');
      commentContainer.setAttribute('collapsed', '');
    }
  }

  videoSizeButton.addEventListener('click', () => {
    boolTheaterMode = !boolTheaterMode;

    if (boolTheaterMode) {
      defaultView();
    }
  });
  commentsEl.addEventListener('click', handleExpandButtonClick);

  chrome.storage.local.get(['comments_placement']).then((data) => {
    if (data.comments_placement === 'default') defaultView();
    else sidebarView();
  });
}
