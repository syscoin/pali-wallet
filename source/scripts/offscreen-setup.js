// Offscreen setup script - runs before webpack bundles to prepare the environment
// This file must remain as plain JavaScript (not TypeScript) to avoid bundling

// Set flag immediately before any bundles load
window.__PALI_OFFSCREEN__ = true;

// Patch chrome.storage to prevent errors during initialization
// The offscreen document doesn't have access to chrome.storage.local
if (typeof chrome !== 'undefined' && !chrome.storage) {
  chrome.storage = {
    local: {
      get: function (keys, callback) {
        callback({});
      },
      set: function (items, callback) {
        if (callback) callback();
      },
      remove: function (keys, callback) {
        if (callback) callback();
      },
    },
    sync: {
      get: function (keys, callback) {
        callback({});
      },
      set: function (items, callback) {
        if (callback) callback();
      },
      remove: function (keys, callback) {
        if (callback) callback();
      },
    },
  };
}

console.log(
  '[Offscreen Setup] Environment prepared for init bundle - flag set and chrome.storage patched'
);
