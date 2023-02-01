/* 
Various sections of YouTube are loaded dynamically.
The code below uses a mutation observer to listen to
DOM changes and check if the comments have been
loaded on the page.
*/
const element = document.getElementById('page-manager');
const config = {
  childList: true,
  subtree: true,
};

const callback = (mutationList, observer) => {
  for (const mutation of mutationList) {
    if (mutation.target.id === 'comments') {
      activateExtension();
      observer.disconnect();
    }
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
  const sidebar = document.querySelector('#secondary');

  commentsEl.classList.add(
    'popout',
    page.hasAttribute('dark') ? 'dark-mode' : 'light-mode'
  );
  commentsEl.style.width = `100%`;
  commentsEl.style.height = `${player.offsetHeight}px`;
  sidebar.prepend(commentsEl);
}

/* Elements to select

#items > #scroll-container : tags above the recommendation feed
.video-stream.html5-main-video: main video player

*/
