import {
  WALLET_TOKEN_REVIEW_PORT,
  walletTokenReviewError,
  type WalletTokenReviewRequest,
} from '../../shared/walletTokenReview';

export function openWalletTokenReview(request: WalletTokenReviewRequest) {
  const port = chrome.runtime.connect({ name: WALLET_TOKEN_REVIEW_PORT });
  let phase: 'reviewing' | 'ready' | 'submitting' | 'finished' | 'closed' =
    'reviewing';
  let readyReview!: () => void;
  let rejectReview!: (error: unknown) => void;
  let finishSend!: () => void;
  let rejectSend!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyReview = resolve;
    rejectReview = reject;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const retire = (error?: unknown) => {
    const previous = phase;
    phase = 'closed';
    clearTimeout(timeout);
    if (previous === 'reviewing')
      rejectReview(error ?? walletTokenReviewError());
    else if (previous === 'submitting')
      rejectSend(
        error ?? new Error('Token submission acknowledgement unavailable.')
      );
  };
  const close = (error?: unknown) => {
    if (phase === 'closed') return;
    retire(error);
    port.disconnect();
  };
  port.onDisconnect.addListener(() => retire());
  port.onMessage.addListener((value: unknown) => {
    if (phase === 'closed') return;
    const reply = value as {
      error?: unknown;
      hash?: unknown;
      type?: unknown;
    } | null;
    if (reply?.type === 'reviewed' && phase === 'reviewing') {
      clearTimeout(timeout);
      phase = 'ready';
      readyReview();
    } else if (
      reply?.type === 'submitted' &&
      phase === 'submitting' &&
      typeof reply.hash === 'string' &&
      /^0x[\da-f]{64}$/i.test(reply.hash)
    ) {
      clearTimeout(timeout);
      phase = 'finished';
      finishSend();
    } else if (reply?.type === 'failure') {
      close(
        typeof reply.error === 'object' && reply.error
          ? reply.error
          : new Error(
              typeof reply.error === 'string'
                ? reply.error
                : 'Wallet operation failed'
            )
      );
    } else close();
  });

  timeout = setTimeout(close, 10_000);
  try {
    port.postMessage(request);
  } catch {
    close();
  }
  const submit = (waitMs: number) => {
    if (phase !== 'ready') return Promise.reject(walletTokenReviewError());
    return new Promise<void>((resolve, reject) => {
      phase = 'submitting';
      finishSend = resolve;
      rejectSend = reject;
      timeout = setTimeout(close, waitMs);
      try {
        port.postMessage('submit');
      } catch {
        close(walletTokenReviewError());
      }
    });
  };
  return { ready, submit, close, isOpen: () => phase !== 'closed' };
}
