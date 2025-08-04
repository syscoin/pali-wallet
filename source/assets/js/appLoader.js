console.log('[HTML] Initial loader ready, waiting for pali-app-ready event');

// Track initialization start time
const initStartTime = Date.now();

// Start timing page load
console.time('[HTML] Total Page Load Time');

// Remove the initial loader once React app signals it's ready
window.addEventListener('pali-app-ready', function () {
  const totalInitTime = Date.now() - initStartTime;
  console.log('[HTML] Received pali-app-ready event, hiding loader');
  console.log('[HTML] Total initialization time:', totalInitTime, 'ms');
  document.body.classList.add('app-loaded');
});

// Log when window fully loads
window.addEventListener('load', function () {
  console.timeEnd('[HTML] Total Page Load Time');
});

// Log when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
  console.log('[HTML] DOM Content Loaded at:', Date.now());
});

// Fallback: hide loader after 3 seconds if something goes wrong
// This should rarely trigger now that we wait for actual content to render
setTimeout(function () {
  if (!document.body.classList.contains('app-loaded')) {
    const elapsedTime = Date.now() - initStartTime;
    console.warn(
      '[HTML] Fallback triggered: hiding loader after',
      elapsedTime,
      'ms'
    );
    document.body.classList.add('app-loaded');
  }
}, 3000);
