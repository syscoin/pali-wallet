/** The popup must not route using empty/default state when its worker is busy. */
// Feedback is independent of acceptance: slow but healthy workers can still reply.
export const WALLET_FEEDBACK_TIMEOUT_MS = 1800;
export const WALLET_BOOTSTRAP_TIMEOUT_MS = 10000;

export const startupFeedbackDelay = () =>
  Math.max(0, WALLET_FEEDBACK_TIMEOUT_MS - performance.now());

export const requestWalletState = (
  timeoutMs = WALLET_BOOTSTRAP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<any> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, state?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (retry) clearTimeout(retry);
      if (error) reject(error);
      else resolve(state);
    };
    const timeout = setTimeout(
      () => finish(new Error('Wallet background is taking longer to respond.')),
      timeoutMs
    );
    const abort = () => finish(new Error('Wallet request cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    const retryWhenStarting = () => {
      // A freshly awakened MV3 worker may not have registered its listener yet.
      // Retry completed connection failures, but keep the overall deadline.
      if (!settled) retry = setTimeout(request, 100);
    };
    const request = () => {
      try {
        chrome.runtime.sendMessage({ type: 'getCurrentState' }, (state) => {
          // Always consume lastError, including a late callback after timeout.
          const error = chrome.runtime.lastError;
          if (settled) return;
          if (error || !state || !state.vault || !state.vaultGlobal) {
            retryWhenStarting();
          } else {
            finish(undefined, state);
          }
        });
      } catch {
        retryWhenStarting();
      }
    };
    request();
  });
