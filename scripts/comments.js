import {
  MUTATION_TARGET_ID,
  MUTATION_TRACKED_ID,
  COMMENTS_ELEMENT,
  COMMENTS_TEXT_CONTAINER,
  BTN_READ_MORE,
  BTN_SHOW_LESS,
  PAGE,
  PLAYER,
  DEFAULT_CONTAINER,
  SIDEBAR_CONTAINER,
  THEATRE_MODE_TOGGLE,
  DARK_MODE_ATTRIBUTE,
} from './constants.js';

/* 
Various sections of YouTube are loaded dynamically.
The code below uses a mutation observer to listen to
DOM changes and check if the comments have been
loaded on the page.
*/
chrome.runtime.onMessage.addListener((request) => {
  if (!request.activate) return;

  const trackedElement = document.querySelector(MUTATION_TRACKED_ID);
  const config = {
    childList: true,
    subtree: true,
  };

  const callback = (mutationList, observer) => {
    if (
      mutationList.some((mutation) => mutation.target.id === MUTATION_TARGET_ID)
    ) {
      activateExtension();
      observer.disconnect();
    }
  };

  const observer = new MutationObserver(callback);
  observer.observe(trackedElement, config);
});

/*
Goes through the comments, determines if the number of lines
is more than 4, and displays the 'Read More' button
to expand the comments.
*/

function expandComments(commentsEl) {
  const commentTextContainer = commentsEl.querySelectorAll(
    COMMENTS_TEXT_CONTAINER
  );
  const lineHeight = Number.parseFloat(
    getComputedStyle(commentTextContainer[0].querySelector('#content-text'))
      .lineHeight
  );

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
Gathers info from the page, like the theme and DOM Tree.
A button is then added to the comments section to toggle between
default view and sidebar view, and event listeners are attached.
*/

function activateExtension() {
  const commentsEl = document.querySelector(COMMENTS_ELEMENT);
  const page = document.querySelector(PAGE);
  const player = document.querySelector(PLAYER);
  const originalCommentsContainer = document.querySelector(DEFAULT_CONTAINER);
  const sidebar = document.querySelector(SIDEBAR_CONTAINER);
  const videoSizeButton = document.querySelector(THEATRE_MODE_TOGGLE);

  let boolTheaterMode = videoSizeButton
    .getAttribute('data-title-no-tooltip')
    .includes('Default');

  const isDark = page.hasAttribute(DARK_MODE_ATTRIBUTE);
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
  }

  if (!commentsEl.querySelector('header')) {
    const header = document.createElement('header');
    header.classList.add('comments-header');
    header.append(popButton);
    commentsEl.prepend(header);
  }

  defaultView();

  // Click event listener to handle the 'Read More' and 'Show Less' button clicks.
  function handleExpandButtonClick(e) {
    if (
      !e.target.classList.contains('more-button') &&
      !e.target.classList.contains('less-button')
    )
      return;

    const commentContainer = e.target.closest(COMMENTS_TEXT_CONTAINER);
    const btnMore = commentContainer.querySelector(BTN_READ_MORE);
    const btnLess = commentContainer.querySelector(BTN_SHOW_LESS);

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
}
