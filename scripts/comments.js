console.log('script start');

/* 
Various sections of YouTube are loaded dynamically.
The code below uses a mutation observer to listen to
DOM changes and check if the comments have been
loaded on the page.
*/
const element = document.getElementById('content');
const config = {
  childList: true,
  subtree: true,
};

const callback = (mutationList, observer) => {
  if (
    mutationList.some((mutation) => {
      // console.log(mutation.target.id);
      return mutation.target.id === 'comments';
    })
  ) {
    console.log('comments found');
    activateExtension();
    observer.disconnect();
  }
};

const observer = new MutationObserver(callback);
observer.observe(element, config);

/*
activates the extension by adding relevant classes
and attaching listeners to the comments section
*/

function activateExtension() {
  const commentsEl = document.querySelector('#comments');
  const page = document.querySelector('html');
  const player = document.querySelector('.video-stream.html5-main-video');
  const originalCommentsContainer = document.querySelector('#below');
  const sidebar = document.querySelector('#secondary');

  const isDark = page.hasAttribute('dark');
  commentsEl.classList.add('extension-control');

  const popButton = document.createElement('button');
  popButton.classList.add('comments-header-btn');

  const header = document.createElement('header');
  header.classList.add('comments-header');
  header.append(popButton);
  commentsEl.prepend(header);

  defaultView();

  function defaultView() {
    commentsEl.style.display = 'none';
    commentsEl.classList.remove('popout', 'dark-mode', 'light-mode');
    commentsEl.style.height = 'auto';

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
    commentsEl.classList.add('popout', isDark ? 'dark-mode' : 'light-mode');
    commentsEl.style.height = `${player.offsetHeight}px`;
    popButton.removeEventListener('click', sidebarView);
    popButton.addEventListener('click', () => {
      defaultView();
      commentsEl.scrollIntoView({ behavior: 'smooth' });
    });

    popButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="comments-icon ${
      isDark ? 'stroke-light' : 'stroke-dark'
    }">
      <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 9l-3 3m0 0l3 3m-3-3h7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"" />
    </svg>`;

    sidebar.prepend(commentsEl);
    page.scrollIntoView({ behavior: 'smooth' });
  }
}
