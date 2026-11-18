import {
  captureLocalPasskeyCommand,
  LOCAL_PASSKEY_DEADLINE_MS,
  LOCAL_PASSKEY_PASSWORD_COOLDOWN,
  LOCAL_PASSKEY_PORT,
} from '../../../shared/localPasskeyTransport';
import { isExternalWalletUrl } from '../../../utils/extensionContexts';
import { assertJsonWorkBudget } from '../../../utils/requestPayloadBudget';
import {
  PasswordCooldownError,
  type LocalPasskeyController,
} from '../../../wallet/localPasskeyTypes';

import { isTrustedExtensionPageSender } from './internalMessageAuthorization';

type Authority = Readonly<{ assertCurrent(): void; signal: AbortSignal }>;

/** One trusted top-level extension document owns a ceremony until final reply or disconnect. */
export function installLocalPasskeyControllerPorts(
  create: (authority: Authority) => LocalPasskeyController,
  runtime: Pick<
    typeof chrome.runtime,
    'onConnect' | 'getContexts' | 'getURL' | 'id'
  > = chrome.runtime
): () => void {
  const owners = new Set<() => void>();
  let closed = false;
  const connect = (port: chrome.runtime.Port) => {
    if (port.name !== LOCAL_PASSKEY_PORT) return;
    const sender = port.sender;
    const senderUrl = sender?.url ?? '';
    const documentId = sender?.documentId;
    let walletAppDocument = false;
    try {
      walletAppDocument = new URL(senderUrl).pathname === '/app.html';
    } catch {
      /* Refuse malformed sender URLs. */
    }
    const toolbarPopup =
      walletAppDocument &&
      sender?.tab === undefined &&
      sender?.frameId === undefined &&
      typeof runtime.getContexts === 'function';
    if (
      closed ||
      owners.size >= 4 ||
      (!walletAppDocument && !isExternalWalletUrl(senderUrl)) ||
      !isTrustedExtensionPageSender(sender!, runtime) ||
      (!toolbarPopup &&
        (sender?.frameId !== 0 ||
          typeof documentId !== 'string' ||
          !documentId))
    ) {
      port.disconnect();
      return;
    }
    let verified = !toolbarPopup;
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
      let passwordAction = false;
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
        if (!verified) {
          // A toolbar popup's sender URL can precede a same-document route
          // change. Match the document URL without its routing fragment.
          const [documentUrl] = senderUrl.split('#', 1);
          const contexts = (
            await runtime.getContexts({
              tabIds: [-1],
              ...(documentId ? { documentIds: [documentId] } : {}),
            })
          ).filter(
            (candidate) =>
              candidate.documentUrl?.split('#', 1)[0] === documentUrl
          );
          authority.assertCurrent();
          const [context] = contexts;
          if (
            contexts.length !== 1 ||
            context?.contextType !== 'POPUP' ||
            context.frameId !== 0
          )
            throw new Error('LOCAL_PASSKEY_UNAVAILABLE');
          verified = true;
        }
        controller ??= create(authority);
        passwordAction =
          command.method === 'beginEnrollment' || command.method === 'disable';
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
      })().catch((error) => {
        if (!lifetime.signal.aborted) {
          try {
            port.postMessage(
              passwordAction && error instanceof PasswordCooldownError
                ? {
                    id,
                    error: LOCAL_PASSKEY_PASSWORD_COOLDOWN,
                    retryAfterSeconds: error.retryAfterSeconds,
                  }
                : { id, error: 'LOCAL_PASSKEY_UNAVAILABLE' }
            );
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
