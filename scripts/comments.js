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
  const commentsEl = document.getElementById('comments');
  commentsEl.classList.add('popout');
}

/* Elements to select

#items > #scroll-container : tags above the recommendation feed
.video-stream.html5-main-video: main video player

*/
