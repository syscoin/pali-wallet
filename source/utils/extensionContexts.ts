import { WALLET_BOOTSTRAP_TIMEOUT_MS } from './requestWalletState';

/** Query live extension pages; persisted popup flags can outlive a closed window. */
export const hasExternalWalletPage = (
  timeoutMs = WALLET_BOOTSTRAP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, active = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(active);
    };
    const timeout = setTimeout(
      () => finish(new Error('Wallet window check timed out.')),
      timeoutMs
    );
    const abort = () => finish(new Error('Wallet window check cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    const matchesExternal = (url?: string) => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        // External uses BrowserRouter: routing changes the same document's
        // pathname, including to / while an approval waits for login.
        const externalPath =
          parsed.pathname === '/external.html' ||
          parsed.pathname === '/external' ||
          parsed.pathname.startsWith('/external/') ||
          (parsed.pathname === '/' &&
            Boolean(parsed.searchParams.get('externalRoute')));
        return (
          parsed.protocol === 'chrome-extension:' &&
          parsed.hostname === chrome.runtime.id &&
          externalPath
        );
      } catch {
        return false;
      }
    };

    try {
      if (typeof chrome.runtime.getContexts === 'function') {
        chrome.runtime.getContexts({}, (contexts) => {
          const error = chrome.runtime.lastError;
          finish(
            error ? new Error('Could not check wallet windows.') : undefined,
            contexts?.some((context) => matchesExternal(context.documentUrl))
          );
        });
      } else {
        // getContexts was added in Chrome 116; the extension also supports 109+.
        chrome.tabs.query({}, (tabs) => {
          const error = chrome.runtime.lastError;
          finish(
            error ? new Error('Could not check wallet windows.') : undefined,
            tabs?.some((tab) => matchesExternal(tab.url))
          );
        });
      }
    } catch {
      finish(new Error('Could not check wallet windows.'));
    }
  });
