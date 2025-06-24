// Handler for preloading the popup using Chrome Offscreen API
// This significantly reduces the popup load time by preloading it in the background

// Track if we have an active offscreen document
let offscreenCreated = false;

let offscreenCreating: Promise<void> | null = null;

/**
 * Creates an offscreen document to preload the popup
 * This makes the popup appear instantly when the user clicks the extension icon
 */
export async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenCreated) {
    console.log('[Offscreen] Document already exists');
    return;
  }

  if (offscreenCreating) {
    console.log('[Offscreen] Creation already in progress');
    return offscreenCreating;
  }

  const createOffscreen = async () => {
    try {
      // Check if offscreen document already exists
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as any],
      });

      if (contexts.length > 0) {
        console.log(
          '[Offscreen] Document already exists (found via getContexts)'
        );
        offscreenCreated = true;
        return;
      }

      console.log('[Offscreen] Creating offscreen document for preloading...');
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING' as any], // Using DOM_SCRAPING as a valid reason
        justification: 'Preloading extension bundles for instant popup display',
      });

      offscreenCreated = true;
      console.log('[Offscreen] Document created successfully');
    } catch (error: any) {
      if (error?.message?.includes('already exists')) {
        console.log('[Offscreen] Document already exists (error caught)');
        offscreenCreated = true;
      } else {
        console.error('[Offscreen] Failed to create document:', error);
        throw error;
      }
    }
  };

  offscreenCreating = createOffscreen();
  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

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
      ensureOffscreenDocument();
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
    ensureOffscreenDocument();
  }, 2000);
});

// Also preload when the browser starts
chrome.runtime.onStartup.addListener(async () => {
  console.log('[OffscreenPreload] Browser started, preloading popup...');
  // Wait a bit for the extension to fully initialize
  setTimeout(() => {
    ensureOffscreenDocument();
  }, 2000);
});

// Listen for when the popup is actually opened
chrome.action.onClicked.addListener(async () => {
  // Note: This won't fire if default_popup is set in manifest
  // But we can use it as a signal to refresh the offscreen document
  if (offscreenCreated) {
    console.log(
      '[OffscreenPreload] Popup clicked, refreshing offscreen document...'
    );
    refreshOffscreenDocument();
  } else {
    console.log('[Offscreen] Ensuring document before popup opens');
    await ensureOffscreenDocument();
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

// Initialize offscreen on extension startup
export async function initializeOffscreenPreload(): Promise<void> {
  try {
    // Create offscreen document immediately on startup
    await ensureOffscreenDocument();

    // Also ensure it's ready before any popup is opened
    chrome.action.onClicked.addListener(async () => {
      console.log('[Offscreen] Ensuring document before popup opens');
      await ensureOffscreenDocument();
    });

    // Recreate if extension is updated
    chrome.runtime.onInstalled.addListener(async (details) => {
      if (details.reason === 'update') {
        console.log(
          '[Offscreen] Extension updated, recreating offscreen document'
        );
        offscreenCreated = false;
        await ensureOffscreenDocument();
      }
    });

    console.log('[Offscreen] Preload handler initialized');
  } catch (error) {
    console.error('[Offscreen] Failed to initialize preload:', error);
  }
}
