// chrome.webNavigation.onCommitted.addEventListener(
//   (e) => {
//     console.log(e);
//     console.log('hehehahaha');
//   },
//   {
//     url: [{ hostSuffix: 'youtube.com/watch' }],
//   }
// );

chrome.tabs.onUpdated.addListener(function (_, changeInfo, tab) {
  if (
    tab.url.includes('youtube.com/watch') &&
    changeInfo.status === 'complete'
  ) {
    console.log('match');
    chrome.tabs.sendMessage(_, { activate: true });
  }
});
