// Minimal offscreen document to keep extension warm and prevent Chrome from terminating it
// This is a performance trick - the offscreen document doesn't actually share cache with the popup

export async function initializeOffscreenPreload(): Promise<void> {
  try {
    // Check if offscreen document already exists
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as any],
    });

    if (contexts.length > 0) {
      console.log('[Offscreen] Document already exists');
      return;
    }

    // Create offscreen document once to keep extension warm
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_SCRAPING' as any], // Using DOM_SCRAPING as a valid reason
      justification: 'Keep extension warm for fast popup loading',
    });

    console.log('[Offscreen] Document created successfully');
  } catch (error: any) {
    // Handle "already exists" error gracefully
    if (error?.message?.includes('already exists')) {
      console.log('[Offscreen] Document already exists');
    } else {
      // Silently fail - offscreen is just a performance optimization
      console.log('[Offscreen] Failed to create:', error.message);
    }
  }
}
