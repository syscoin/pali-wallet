import React, { PropsWithChildren, useEffect, useState } from 'react';

import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import {
  startupFeedbackDelay,
  WALLET_FEEDBACK_TIMEOUT_MS,
  requestWalletState,
} from 'utils/requestWalletState';

/** Keep signing and routing unavailable until authoritative state is hydrated. */
export const WalletBootstrap = ({ children }: PropsWithChildren) => {
  const [attempt, setAttempt] = useState(0);
  const [isSlow, setIsSlow] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );

  useEffect(() => {
    // React now owns a visible loading/recovery screen, even if boot fails.
    window.dispatchEvent(new CustomEvent('pali-app-ready'));
    let active = true;
    setStatus('loading');
    setIsSlow(false);
    const abortController = new AbortController();
    const feedbackTimer = setTimeout(
      () => setIsSlow(true),
      attempt === 0 ? startupFeedbackDelay() : WALLET_FEEDBACK_TIMEOUT_MS
    );

    const initialize = async () => {
      try {
        const state = await requestWalletState(
          undefined,
          abortController.signal
        );
        if (!active) return;
        await rehydrateStore(store, state);
        if (!active) return;
        clearTimeout(feedbackTimer);
        setStatus('ready');
        // Schedule updates only after a successful connection. This does not
        // block first paint and a disconnected worker can be retried later.
        chrome.runtime.sendMessage({ type: 'startPolling' }, () => {
          void chrome.runtime.lastError;
        });
      } catch {
        if (active) setStatus('error');
      }
    };
    void initialize();
    return () => {
      active = false;
      clearTimeout(feedbackTimer);
      abortController.abort();
    };
  }, [attempt]);

  if (status === 'ready') return <>{children}</>;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#061120] p-6 text-center text-white">
      <h1 className="mb-5 font-poppins text-3xl text-[#4DA2CF]">Pali Wallet</h1>
      <p role="status" aria-live="polite" className="mb-4 text-sm">
        {status === 'loading' && !isSlow
          ? 'Connecting to your wallet…'
          : 'Your wallet is taking longer to respond. You can retry while it connects.'}
      </p>
      {(isSlow || status === 'error') && (
        <button
          type="button"
          onClick={() => {
            // A degraded worker only restarts initialization on user request.
            // Healthy workers may not expose this method; ignore that response.
            try {
              chrome.runtime.sendMessage(
                {
                  type: 'CONTROLLER_ACTION',
                  data: { methods: ['retryInitialization'], params: [] },
                },
                () => void chrome.runtime.lastError
              );
            } catch {
              // The bounded state request still supplies recovery feedback.
            }
            setAttempt((value) => value + 1);
          }}
          className="rounded-lg bg-[#4DA2CF] px-5 py-3 font-medium text-[#061120] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Retry connection
        </button>
      )}
    </div>
  );
};
