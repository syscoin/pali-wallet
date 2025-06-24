// Handler for preloading the popup using Chrome Offscreen API
// This significantly reduces the popup load time by preloading it in the background

// Track if we have an active offscreen document
let offscreenCreated = false;

/**
 * Creates an offscreen document to preload the popup
 * This makes the popup appear instantly when the user clicks the extension icon
 */
export const handleOffscreenPreload = async () => {
  try {
    // Check if chrome.offscreen API is available (Chrome 109+)
    if (!chrome.offscreen) {
      console.log('[OffscreenPreload] Offscreen API not available');
      return;
    }

    // Check if we already have an offscreen document
    const hasDocument = await chrome.offscreen.hasDocument();

    if (!hasDocument) {
      console.log(
        '[OffscreenPreload] Creating offscreen document for popup preload...'
      );

      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [
          chrome.offscreen.Reason.DOM_SCRAPING as chrome.offscreen.Reason,
        ],
        justification:
          'Preload popup for faster load times when user clicks extension icon',
      });

      offscreenCreated = true;
      console.log('[OffscreenPreload] Offscreen document created successfully');
    } else {
      console.log('[OffscreenPreload] Offscreen document already exists');
    }
  } catch (error) {
    console.error(
      '[OffscreenPreload] Failed to create offscreen document:',
      error
    );
  }
};

/**
 * Closes the offscreen document if it exists
 * Call this when you need to free up resources
 */
export const closeOffscreenDocument = async () => {
  try {
    if (!chrome.offscreen) return;

    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) {
      await chrome.offscreen.closeDocument();
      offscreenCreated = false;
      console.log('[OffscreenPreload] Offscreen document closed');
    }
  } catch (error) {
    console.error(
      '[OffscreenPreload] Failed to close offscreen document:',
      error
    );
  }
};

/**
 * Refreshes the offscreen document to ensure it stays fresh
 * This prevents stale content and memory issues
 */
export const refreshOffscreenDocument = async () => {
  try {
    console.log('[OffscreenPreload] Refreshing offscreen document...');
    await closeOffscreenDocument();
    // Wait a bit before recreating
    setTimeout(() => {
      handleOffscreenPreload();
    }, 100);
  } catch (error) {
    console.error(
      '[OffscreenPreload] Failed to refresh offscreen document:',
      error
    );
  }
};

// Listen for extension install/update to preload immediately
chrome.runtime.onInstalled.addListener(async () => {
  console.log(
    '[OffscreenPreload] Extension installed/updated, preloading popup...'
  );
  // Wait a bit for the extension to fully initialize
  setTimeout(() => {
    handleOffscreenPreload();
  }, 2000);
});

// Also preload when the browser starts
chrome.runtime.onStartup.addListener(async () => {
  console.log('[OffscreenPreload] Browser started, preloading popup...');
  // Wait a bit for the extension to fully initialize
  setTimeout(() => {
    handleOffscreenPreload();
  }, 2000);
});

// Listen for when the popup is actually opened
chrome.action.onClicked.addListener(() => {
  // Note: This won't fire if default_popup is set in manifest
  // But we can use it as a signal to refresh the offscreen document
  if (offscreenCreated) {
    console.log(
      '[OffscreenPreload] Popup clicked, refreshing offscreen document...'
    );
    refreshOffscreenDocument();
  }
});

// Set up periodic refresh (every 5 minutes) to keep the offscreen document fresh
chrome.alarms.create('refresh-offscreen', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh-offscreen' && offscreenCreated) {
    console.log('[OffscreenPreload] Periodic refresh triggered');
    refreshOffscreenDocument();
  }
});
