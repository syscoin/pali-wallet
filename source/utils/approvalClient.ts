export const APPROVAL_REGISTER = 'PALI_APPROVAL_REGISTER';
export const APPROVAL_CLIENT_READY = 'pali-approval-client-ready';
export const APPROVAL_HANDSHAKE_TIMEOUT_MS = 1800;

/** Bind the initial approval document before BrowserRouter changes its URL. */
export const connectApprovalClient = (
  signal?: AbortSignal,
  timeoutMs = APPROVAL_HANDSHAKE_TIMEOUT_MS
): Promise<void> => {
  let approvalId: string | undefined;
  try {
    const url = new URL(window.location.href);
    approvalId = JSON.parse(url.searchParams.get('data') || '{}').approvalId;
    // Standalone external/hardware pages do not belong to a dapp approval.
    if (!approvalId) return Promise.resolve();
    if (typeof approvalId !== 'string' || url.pathname !== '/external.html') {
      return Promise.reject(
        new Error(
          'This approval has expired. Close this window and request it again.'
        )
      );
    }
  } catch {
    return Promise.reject(
      new Error(
        'Could not read this approval. Close this window and request it again.'
      )
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let channel: MessageChannel | undefined;
    const closeChannel = () => {
      channel?.port1.close();
      channel?.port2.close();
      channel = undefined;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (retry) clearTimeout(retry);
      closeChannel();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error('Approval connection cancelled.'));
    const deadline = setTimeout(
      () =>
        finish(
          new Error(
            'Approval connection timed out. Retry or close this window and request it again.'
          )
        ),
      timeoutMs
    );
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    try {
      // Chrome binds this registration to the popup's tab/window/document.
      // The challenge bridges that identity to ServiceWorker Client.id, which
      // remains stable across same-document routing but changes on reload.
      chrome.runtime.sendMessage(
        { type: APPROVAL_REGISTER, approvalId },
        (reply) => {
          if (settled) return;
          if (chrome.runtime.lastError || reply?.status === 'unavailable') {
            finish(
              new Error(
                'This approval is no longer available. Close this window and request it again.'
              )
            );
            return;
          }
          if (
            reply?.approvalId !== approvalId ||
            reply?.status !== 'registered' ||
            typeof reply?.challenge !== 'string' ||
            !reply.challenge
          )
            return;

          const bind = () => {
            if (settled) return;
            closeChannel();
            const worker = navigator.serviceWorker?.controller;
            if (worker) {
              try {
                channel = new MessageChannel();
                channel.port1.onmessage = (event) => {
                  if (
                    event.data?.eventName !== APPROVAL_CLIENT_READY ||
                    event.data?.approvalId !== approvalId
                  )
                    return;
                  if (event.data?.status === 'ready') finish();
                  else if (event.data?.status === 'unavailable') {
                    finish(
                      new Error(
                        'This approval has expired. Close this window and request it again.'
                      )
                    );
                  }
                };
                channel.port1.start();
                worker.postMessage(
                  {
                    eventName: APPROVAL_CLIENT_READY,
                    approvalId,
                    challenge: reply.challenge,
                  },
                  [channel.port2]
                );
                return;
              } catch {
                closeChannel();
              }
            }
            if (!settled) retry = setTimeout(bind, 100);
          };
          bind();
        }
      );
    } catch {
      finish(
        new Error(
          'Could not connect this approval. Retry or close this window.'
        )
      );
    }
  });
};
