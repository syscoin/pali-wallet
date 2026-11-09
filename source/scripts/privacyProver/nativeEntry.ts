import { createNativeProofPage } from './nativeHost';

const pageWindow = globalThis as typeof globalThis & {
  PaliPrivacyProof?: ReturnType<typeof createNativeProofPage>;
  webkit?: {
    messageHandlers?: {
      PaliPrivateProver?: { postMessage(json: string): void };
    };
  };
};
if (typeof window !== 'undefined') {
  const id = location.hostname.split('.')[0] ?? '';
  const makeWorker = (kind: 'main' | 'sub' | 'sentry') =>
    kind === 'sentry'
      ? new Worker(
          new URL(
            /* webpackChunkName: "sentry-crypto" */ './sentryWorker.ts',
            import.meta.url
          )
        )
      : kind === 'main'
      ? new Worker(
          new URL(
            /* webpackChunkName: "proof-main" */ './worker.ts',
            import.meta.url
          )
        )
      : new Worker(
          new URL(
            /* webpackChunkName: "proof-sub" */ './subworker.ts',
            import.meta.url
          )
        );
  const native = pageWindow.webkit?.messageHandlers?.PaliPrivateProver;
  if (native) {
    pageWindow.PaliPrivacyProof = createNativeProofPage(
      id,
      (json) => native.postMessage(json),
      makeWorker,
      () => new MessageChannel()
    );
    if (
      globalThis.isSecureContext &&
      crypto.subtle &&
      typeof DecompressionStream === 'function'
    )
      pageWindow.PaliPrivacyProof.ready();
  } else {
    // Android transfers this capability only to the exact main-frame origin.
    window.addEventListener('message', function attach(event: MessageEvent) {
      if (
        event.data !== id ||
        event.ports.length !== 1 ||
        pageWindow.PaliPrivacyProof
      )
        return;
      const port = event.ports[0]!;
      const page = createNativeProofPage(
        id,
        (json) => port.postMessage(json),
        makeWorker,
        () => new MessageChannel()
      );
      pageWindow.PaliPrivacyProof = page;
      port.onmessage = ({ data }) => {
        try {
          const request = JSON.parse(data);
          if (request.id !== id) return;
          if (request.type === 'start' && typeof request.input === 'string')
            page.start(id, request.input);
          else if (
            request.type === 'startSentry' &&
            typeof request.input === 'string'
          )
            page.startSentry(id, request.input);
          else if (request.type === 'cancel') page.cancel(id);
          else if (request.type === 'cancelSentry') page.cancelSentry(id);
        } catch {
          page.cancel(id);
        }
      };
      port.start();
      window.removeEventListener('message', attach);
      if (
        globalThis.isSecureContext &&
        crypto.subtle &&
        typeof DecompressionStream === 'function'
      )
        page.ready();
    });
  }
}
