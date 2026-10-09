import { WALLET_BOOTSTRAP_TIMEOUT_MS } from './requestWalletState';

export const isExternalWalletUrl = (url?: string) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
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
    const queryTabs = () => {
      chrome.tabs.query({}, (tabs) => {
        const error = chrome.runtime.lastError;
        finish(
          error ? new Error('Could not check wallet windows.') : undefined,
          tabs?.some(
            (tab) =>
              isExternalWalletUrl(tab.url) ||
              isExternalWalletUrl(tab.pendingUrl)
          )
        );
      });
    };

    try {
      if (typeof chrome.runtime.getContexts === 'function') {
        chrome.runtime.getContexts({}, (contexts) => {
          const error = chrome.runtime.lastError;
          if (error) finish(new Error('Could not check wallet windows.'));
          else if (
            contexts?.some((context) =>
              isExternalWalletUrl(context.documentUrl)
            )
          )
            finish(undefined, true);
          else if (!settled) {
            try {
              queryTabs();
            } catch {
              finish(new Error('Could not check wallet windows.'));
            }
          }
        });
      } else {
        // getContexts was added in Chrome 116; the extension also supports 109+.
        queryTabs();
      }
    } catch {
      finish(new Error('Could not check wallet windows.'));
    }
  });
