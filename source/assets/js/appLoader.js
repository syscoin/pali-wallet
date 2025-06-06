console.log('[HTML] Initial loader ready, waiting for pali-app-ready event');

// Remove the initial loader once React app signals it's ready
window.addEventListener('pali-app-ready', function () {
  console.log('[HTML] Received pali-app-ready event, hiding loader');
  document.body.classList.add('app-loaded');
});

// Fallback: remove loader after 3 seconds if something goes wrong
setTimeout(function () {
  if (!document.body.classList.contains('app-loaded')) {
    console.log('[HTML] Fallback: hiding loader after 3 seconds');
    document.body.classList.add('app-loaded');
  }
}, 3000);
