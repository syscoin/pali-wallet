import { isTrustedSigningWorkerSender } from '../slhDsa/messageAuthorization';
import {
  isPrivacyProofJobId,
  PRIVACY_PROVER_PORT_PREFIX,
} from 'utils/privacy/proverTypes';
export function installPrivacyProverHost(
  makeWorker: (kind: 'main' | 'sub') => Worker,
  makeChannel: () => MessageChannel = () => new MessageChannel()
) {
  let connection: chrome.runtime.Port | undefined;
  let disposeActive: (() => void) | undefined;

  function connect(id: string) {
    if (connection) return;
    const port = chrome.runtime.connect({
      name: PRIVACY_PROVER_PORT_PREFIX + id,
    });
    connection = port;
    port.onDisconnect.addListener(() => {
      if (connection === port) {
        disposeActive?.();
        connection = undefined;
      }
    });
    port.onMessage.addListener((message) => {
      // Disconnect can leave queued callbacks. A retired port owns neither
      // future worker creation nor cancellation of the replacement job.
      if (connection !== port) return;
      if (message?.type === 'cancel') {
        disposeActive?.();
        return;
      }
      if (message?.type !== 'prove' || message.id !== id) return;
      if (disposeActive) {
        port.postMessage({ id: message.id, type: 'error' });
        return;
      }
      const workers: Worker[] = [];
      const channels: MessageChannel[] = [];
      let settled = false;
      const finish = (response?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        for (const worker of workers) worker.terminate();
        for (const channel of channels) {
          channel.port1.close();
          channel.port2.close();
        }
        disposeActive = undefined;
        if (response) {
          try {
            port.postMessage(response);
          } catch {
            /* Disconnected caller. */
          }
        }
      };
      const timeout = setTimeout(
        () => finish({ id: message.id, type: 'error' }),
        120000
      );
      disposeActive = () => finish();
      try {
        const main = makeWorker('main');
        workers.push(main);
        main.onmessage = (event) => {
          if (event.data?.id !== message.id || settled) return;
          if (event.data.type === 'progress') {
            port.postMessage(event.data);
            return;
          }
          finish(event.data);
        };
        const fail = () => finish({ id: message.id, type: 'error' });
        main.onerror = fail;
        const ports: MessagePort[] = [];
        for (let i = 0; i < 2; i++) {
          const worker = makeWorker('sub');
          workers.push(worker);
          worker.onerror = fail;
          const channel = makeChannel();
          channels.push(channel);
          ports.push(channel.port1);
          worker.postMessage({ port: channel.port2 }, [channel.port2]);
        }
        main.postMessage(
          { id: message.id, input: message.input, ports },
          ports
        );
        message.input.nullifier = '';
        message.input.secret = '';
      } catch {
        finish({ id: message.id, type: 'error' });
      }
    });
  }

  // Only a public connect request uses runtime broadcast. Witnesses travel back
  // over the offscreen-initiated private Port, never a runtime.sendMessage call.
  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    sender,
    reply
  ) => {
    if (
      ![
        'PALI_PRIVACY_PROVER_CONNECT',
        'PALI_PRIVACY_PROVER_READY_QUERY',
        'PALI_PRIVACY_PROVER_CANCEL_WORKER',
      ].includes(message?.type)
    )
      return false;
    if (!isTrustedSigningWorkerSender(sender)) {
      reply({ success: false });
      return false;
    }
    if (message.type === 'PALI_PRIVACY_PROVER_READY_QUERY') {
      announceReady();
      reply({ success: true });
      return false;
    }
    if (message.type === 'PALI_PRIVACY_PROVER_CANCEL_WORKER') {
      disposeActive?.();
      const retired = connection;
      connection = undefined;
      retired?.disconnect();
      reply({ success: true });
      return false;
    }
    if (!isPrivacyProofJobId(message.id)) {
      reply({ success: false });
      return false;
    }
    // A new background request owns a new port, including when the previous
    // disconnect event is still queued after cancellation.
    disposeActive?.();
    const previous = connection;
    connection = undefined;
    previous?.disconnect();
    connect(message.id);
    reply({ success: true });
    return false;
  };
  const announceReady = () => {
    void chrome.runtime
      .sendMessage({ type: 'PALI_PRIVACY_PROVER_READY', version: 1 })
      .catch(() => undefined);
  };
  chrome.runtime.onMessage.addListener(listener);
  announceReady();
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
    disposeActive?.();
    const retired = connection;
    connection = undefined;
    retired?.disconnect();
  };
}
