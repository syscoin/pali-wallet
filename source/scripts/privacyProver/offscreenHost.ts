import { isTrustedSigningWorkerSender } from '../slhDsa/messageAuthorization';
import {
  isPrivacyProofJobId,
  PRIVACY_PROVER_PORT_PREFIX,
} from 'utils/privacy/proverTypes';

import { startPrivacyProofWorkers } from './workerHost';
export function installPrivacyProverHost(
  makeWorker: (kind: 'main' | 'sub') => Worker,
  makeChannel: () => MessageChannel = () => new MessageChannel()
) {
  let connection: chrome.runtime.Port | undefined;
  let disposeActive: (() => boolean) | undefined;
  let retirementFailed = false;
  const retireActive = () => {
    if (disposeActive && !disposeActive()) retirementFailed = true;
    disposeActive = undefined;
  };

  function connect(id: string) {
    if (connection) return;
    const port = chrome.runtime.connect({
      name: PRIVACY_PROVER_PORT_PREFIX + id,
    });
    connection = port;
    port.onDisconnect.addListener(() => {
      if (connection === port) {
        retireActive();
        connection = undefined;
      }
    });
    port.onMessage.addListener((message) => {
      // Disconnect can leave queued callbacks. A retired port owns neither
      // future worker creation nor cancellation of the replacement job.
      if (connection !== port) return;
      if (message?.type === 'cancel') {
        retireActive();
        return;
      }
      if (message?.type !== 'prove' || message.id !== id) return;
      if (disposeActive || retirementFailed) {
        port.postMessage({ id: message.id, type: 'error' });
        return;
      }
      const job = startPrivacyProofWorkers(
        makeWorker,
        makeChannel,
        'extension-public',
        message.id,
        message.input,
        (response) => {
          if (response.type !== 'progress') disposeActive = undefined;
          try {
            port.postMessage(response);
          } catch {
            /* Disconnected caller. */
          }
        }
      );
      disposeActive = job.isRetired() ? undefined : job.cancel;
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
      retireActive();
      const retired = connection;
      connection = undefined;
      retired?.disconnect();
      reply({ success: !retirementFailed });
      return false;
    }
    if (!isPrivacyProofJobId(message.id)) {
      reply({ success: false });
      return false;
    }
    // A new background request owns a new port, including when the previous
    // disconnect event is still queued after cancellation.
    retireActive();
    const previous = connection;
    connection = undefined;
    previous?.disconnect();
    if (!retirementFailed) connect(message.id);
    reply({ success: !retirementFailed });
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
    retireActive();
    const retired = connection;
    connection = undefined;
    retired?.disconnect();
  };
}
