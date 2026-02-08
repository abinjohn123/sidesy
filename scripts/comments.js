/* 
Various sections of YouTube are loaded dynamically.
The code below uses a mutation observer to listen to
DOM changes and check if the comments have been
loaded on the page.
*/
// Track if we're already initialized to prevent multiple activations
let extensionInitialized = false;

chrome.runtime.onMessage.addListener((request) => {
  if (!request.activate) return;

  console.log('[Sidesy] Activation message received');

  // Prevent multiple initialization attempts
  if (extensionInitialized) {
    console.log('[Sidesy] Already initialized, ignoring duplicate activation message');
    return;
  }
  extensionInitialized = true;

  let activationAttempted = false;

  // Helper function to check if comments are ready
  function areCommentsReady() {
    const comments = document.getElementById('comments');
    console.log('[Sidesy] Checking comments:', comments);
    if (comments) {
      console.log('[Sidesy] Has hidden attribute:', comments.hasAttribute('hidden'));
      console.log('[Sidesy] Comments children:', comments.children.length);
      console.log('[Sidesy] Comments innerHTML length:', comments.innerHTML.length);
    }
    // Check if comments exist, are not hidden, and have content
    return comments &&
           !comments.hasAttribute('hidden') &&
           comments.innerHTML.length > 100;
  }

  // Try to activate extension
  function tryActivate() {
    if (activationAttempted) return true; // Already activated
    if (areCommentsReady()) {
      console.log('[Sidesy] Activating extension');
      activationAttempted = true;
      activateExtension();
      return true;
    }
    return false;
  }

  // Check if comments already exist and are loaded
  if (tryActivate()) {
    return;
  }

  // Otherwise, wait for comments to load
  const trackedElement = document.getElementById('content');
  console.log('[Sidesy] Setting up observer on:', trackedElement);

  let observer = null; // Declare observer outside so it's accessible in cleanup

  // Only set up observer if we have an element to observe
  if (trackedElement) {
    const config = {
      childList: true,
      subtree: true,
    };

    const callback = (mutationList, observer) => {
      console.log('[Sidesy] Mutation detected, mutations count:', mutationList.length);

      if (tryActivate()) {
        console.log('[Sidesy] Successfully activated, disconnecting observer');
        observer.disconnect();
      }
    };

    observer = new MutationObserver(callback);
    observer.observe(trackedElement, config);
  } else {
    console.log('[Sidesy] #content element not found, relying on periodic checks');
  }

  // Failsafe: check periodically for up to 10 seconds
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    console.log('[Sidesy] Periodic check attempt:', attempts);
    if (tryActivate() || attempts >= 20) {
      clearInterval(interval);
      if (observer) observer.disconnect(); // Only disconnect if observer exists
    }
  }, 500);
});

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
