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

// Fallback: remove loader after 6 seconds if something goes wrong
// Increased from 3s to 6s to handle slower browser-initiated loads
setTimeout(function () {
  if (!document.body.classList.contains('app-loaded')) {
    const elapsedTime = Date.now() - initStartTime;
    console.log('[HTML] Fallback: hiding loader after', elapsedTime, 'ms');
    document.body.classList.add('app-loaded');
  }
}, 6000);
