import {
  captureLocalPasskeyCommand,
  LOCAL_PASSKEY_DEADLINE_MS,
  LOCAL_PASSKEY_PORT,
} from '../../../shared/localPasskeyTransport';
import { isExternalWalletUrl } from '../../../utils/extensionContexts';
import { assertJsonWorkBudget } from '../../../utils/requestPayloadBudget';

import { isTrustedExtensionPageSender } from './internalMessageAuthorization';
import type { LocalPasskeyController } from '../../../wallet/localPasskeyTypes';

type Authority = Readonly<{ assertCurrent(): void; signal: AbortSignal }>;

/** One trusted top-level extension document owns a ceremony until final reply or disconnect. */
export function installLocalPasskeyControllerPorts(
  create: (authority: Authority) => LocalPasskeyController,
  runtime: Pick<
    typeof chrome.runtime,
    'onConnect' | 'getURL' | 'id'
  > = chrome.runtime
): () => void {
  const owners = new Set<() => void>();
  let closed = false;
  const connect = (port: chrome.runtime.Port) => {
    if (port.name !== LOCAL_PASSKEY_PORT) return;
    const sender = port.sender;
    let walletDocument = false;
    try {
      walletDocument =
        new URL(sender?.url ?? '').pathname === '/app.html' ||
        isExternalWalletUrl(sender?.url ?? '');
    } catch {
      /* Refuse malformed sender URLs. */
    }
    if (
      closed ||
      owners.size >= 4 ||
      !walletDocument ||
      !isTrustedExtensionPageSender(sender!, runtime) ||
      typeof sender?.documentId !== 'string' ||
      !sender.documentId ||
      sender.frameId !== 0
    ) {
      port.disconnect();
      return;
    }
    const lifetime = new AbortController();
    let controller: LocalPasskeyController | undefined;
    let busy = false,
      started = false,
      lastId = 0;
    const retire = () => {
      if (lifetime.signal.aborted) return;
      lifetime.abort();
      clearTimeout(deadline);
      owners.delete(retire);
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(retire);
      void controller?.dispose().catch(() => undefined);
      try {
        port.disconnect();
      } catch {
        /* The document is gone. */
      }
    };
    const authority: Authority = Object.freeze({
      signal: lifetime.signal,
      assertCurrent() {
        if (closed || lifetime.signal.aborted)
          throw new Error('LOCAL_PASSKEY_UNAVAILABLE');
      },
    });
    const receive = (raw: unknown) => {
      let id = 0;
      void (async () => {
        authority.assertCurrent();
        assertJsonWorkBudget(raw);
        const command = captureLocalPasskeyCommand(raw);
        id = command.id;
        if (
          busy ||
          id <= lastId ||
          (started && command.method !== 'complete') ||
          (!started && command.method === 'complete')
        )
          throw new Error('LOCAL_PASSKEY_UNAVAILABLE');
        busy = true;
        lastId = id;
        controller ??= create(authority);
        let result: unknown;
        switch (command.method) {
          case 'status':
            result = await controller.status();
            break;
          case 'disable':
            await controller.disable(command.params[0]);
            result = null;
            break;
          case 'beginEnrollment':
            started = true;
            result = await controller.beginEnrollment(command.params[0]);
            break;
          case 'beginUnlock':
            started = true;
            result = await controller.beginUnlock();
            break;
          case 'complete':
            result = await controller.complete(...command.params);
            break;
        }
        authority.assertCurrent();
        busy = false;
        port.postMessage({ id, result });
        if (
          command.method === 'status' ||
          command.method === 'disable' ||
          (result &&
            typeof result === 'object' &&
            'kind' in result &&
            result.kind === 'complete')
        )
          retire();
      })().catch(() => {
        if (!lifetime.signal.aborted) {
          try {
            port.postMessage({ id, error: 'LOCAL_PASSKEY_UNAVAILABLE' });
          } catch {
            /* Retire regardless. */
          }
        }
        retire();
      });
    };
    const deadline = setTimeout(retire, LOCAL_PASSKEY_DEADLINE_MS);
    owners.add(retire);
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(retire);
  };
  runtime.onConnect.addListener(connect);
  return () => {
    closed = true;
    runtime.onConnect.removeListener(connect);
    for (const retire of [...owners]) retire();
  };
}
