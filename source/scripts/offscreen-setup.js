// Offscreen setup script - runs before webpack bundles to prepare the environment
// This file must remain as plain JavaScript (not TypeScript) to avoid bundling

// Set flag immediately before any bundles load
window.__PALI_OFFSCREEN__ = true;

// Patch chrome.storage to prevent errors during initialization
// The offscreen document doesn't have access to chrome.storage.local
if (typeof chrome !== 'undefined' && !chrome.storage) {
  let emptyStorageGetResult = function (keys) {
    if (typeof keys === 'string') {
      return {};
    }
    if (Array.isArray(keys)) {
      return {};
    }
    if (keys && typeof keys === 'object') {
      return Object.assign({}, keys);
    }
    return {};
  };

  chrome.storage = {
    local: {
      get: function (keys, callback) {
        let result = emptyStorageGetResult(keys);
        if (typeof callback === 'function') {
          callback(result);
          return undefined;
        }
        return Promise.resolve(result);
      },
      set: function (items, callback) {
        if (typeof callback === 'function') {
          callback();
          return undefined;
        }
        return Promise.resolve();
      },
      remove: function (keys, callback) {
        if (typeof callback === 'function') {
          callback();
          return undefined;
        }
        return Promise.resolve();
      },
    },
    sync: {
      get: function (keys, callback) {
        let result = emptyStorageGetResult(keys);
        if (typeof callback === 'function') {
          callback(result);
          return undefined;
        }
        return Promise.resolve(result);
      },
      set: function (items, callback) {
        if (typeof callback === 'function') {
          callback();
          return undefined;
        }
        return Promise.resolve();
      },
      remove: function (keys, callback) {
        if (typeof callback === 'function') {
          callback();
          return undefined;
        }
        return Promise.resolve();
      },
    },
  };
}

console.log(
  '[Offscreen Setup] Environment prepared for init bundle - flag set and chrome.storage patched'
);
