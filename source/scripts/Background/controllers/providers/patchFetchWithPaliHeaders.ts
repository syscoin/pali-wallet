/**
 * Patches the global fetch function to add Pali headers to RPC requests
 * This ensures all web3 provider requests include identification headers
 */

let originalFetch: typeof fetch | null = null;

/**
 * Gets the extension version in a cross-browser compatible way
 */
function getExtensionVersion(): string {
  try {
    // Try browser API first (Firefox, Safari)
    if (
      typeof (globalThis as any).browser !== 'undefined' &&
      (globalThis as any).browser.runtime &&
      (globalThis as any).browser.runtime.getManifest
    ) {
      return (globalThis as any).browser.runtime.getManifest().version;
    }
    // Fall back to chrome API
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.getManifest
    ) {
      return chrome.runtime.getManifest().version;
    }
  } catch (error) {
    console.warn('Could not get extension version:', error);
  }
  // Default version if APIs are not available
  return '1.0.0';
}

export function getPaliHeaders(): Record<string, string> {
  const version = getExtensionVersion();
  return {
    'X-Pali-Wallet': 'true',
    'X-Pali-Version': version,
    'X-Requested-With': 'XMLHttpRequest', // Hints to server this is AJAX (may prevent WWW-Authenticate)
    'User-Agent': `PaliWallet/${version}`,
  };
}

/**
 * Checks if a request is likely a JSON-RPC request based on the body
 */
function isJsonRpcRequest(init?: RequestInit): boolean {
  if (!init?.body) return false;

  try {
    const bodyStr = typeof init.body === 'string' ? init.body : '';
    if (!bodyStr) return false;

    const parsed = JSON.parse(bodyStr);
    // Check for JSON-RPC structure
    return (
      parsed.jsonrpc === '2.0' &&
      typeof parsed.method === 'string' &&
      ('params' in parsed || 'id' in parsed)
    );
  } catch {
    return false;
  }
}

export function patchFetchWithPaliHeaders(): void {
  // Store the original fetch if not already stored
  if (!originalFetch) {
    originalFetch = global.fetch || window.fetch;
  }

  // Create the patched fetch function
  const patchedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    // Add headers to:
    // 1. All POST requests that look like JSON-RPC
    // 2. Requests to known RPC endpoints (common patterns)
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof Request
        ? input.url
        : input.toString();

    const isPostRequest =
      init?.method === 'POST' || (!init?.method && init?.body);

    // Check if this is likely a web3 RPC request
    const shouldAddHeaders = isPostRequest && isJsonRpcRequest(init);

    if (shouldAddHeaders) {
      init = init || {};
      init.headers = {
        ...init.headers,
        ...getPaliHeaders(),
      };

      // Prevent browser authentication dialogs by omitting credentials
      // This tells the browser not to include cookies or HTTP auth
      init.credentials = 'omit';

      console.log('Adding Pali headers to request:', requestUrl);
    }

    try {
      return await originalFetch!(input, init);
    } catch (error) {
      // If we get a TypeError that might be from auth cancellation, wrap it
      if (
        error instanceof TypeError &&
        error.message.includes('Failed to fetch')
      ) {
        throw new Error(
          'Network request failed - authentication may be required'
        );
      }
      throw error;
    }
  };

  // Replace global fetch
  (global as any).fetch = patchedFetch;
  if (typeof window !== 'undefined') {
    (window as any).fetch = patchedFetch;
  }
}

export function unpatchFetch(): void {
  if (originalFetch) {
    (global as any).fetch = originalFetch;
    if (typeof window !== 'undefined') {
      (window as any).fetch = originalFetch;
    }
  }
}
