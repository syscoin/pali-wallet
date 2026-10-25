import { ensureOffscreenDocument } from 'utils/slhDsa/offscreenClient';

import { privacyPublicSignals, validatePrivacyProofInput } from './proverCore';
import type {
  IPrivacyProofInput,
  IPrivacyProofOptions,
  IPrivacyProofProgress,
  IPrivacyProofResult,
} from './proverTypes';
import { isPrivacyProofJobId, PRIVACY_PROVER_PORT_PREFIX } from './proverTypes';
let listenerInstalled = false;
let waitingPort:
  | {
      accept: (port: chrome.runtime.Port) => void;
      id: string;
      requestConnect: () => void;
    }
  | undefined;
let active: { abort: AbortController; id: string } | undefined;
const cancelled = () => new Error('privacy_proof_cancelled');

const isTrustedHost = (sender?: chrome.runtime.MessageSender) =>
  sender?.id === chrome.runtime.id &&
  !sender.tab &&
  sender.url === chrome.runtime.getURL('offscreen.html');
const isMissingReceiver = (error: unknown) =>
  error instanceof Error &&
  error.message.includes('Receiving end does not exist');

function installListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(PRIVACY_PROVER_PORT_PREFIX)) return;
    const id = port.name.slice(PRIVACY_PROVER_PORT_PREFIX.length);
    if (
      !isTrustedHost(port.sender) ||
      !isPrivacyProofJobId(id) ||
      !waitingPort ||
      waitingPort.id !== id
    ) {
      port.disconnect();
      return;
    }
    const accept = waitingPort.accept;
    waitingPort = undefined;
    accept(port);
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'PALI_PRIVACY_PROVER_READY') return false;
    if (message.version !== 1 || !isTrustedHost(sender)) {
      reply({ success: false });
      return false;
    }
    waitingPort?.requestConnect();
    reply({ success: true });
    return false;
  });
}

function connect(
  signal: AbortSignal,
  id: string
): Promise<chrome.runtime.Port> {
  installListener();
  return new Promise((resolve, reject) => {
    let connectSent = false;
    const cleanup = () => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      if (waitingPort === waiter) waitingPort = undefined;
      cleanup();
      reject(error);
    };
    const accept = (port: chrome.runtime.Port) => {
      cleanup();
      resolve(port);
    };
    const abort = () => fail(cancelled());
    const requestConnect = () => {
      if (waitingPort !== waiter || signal.aborted || connectSent) return;
      connectSent = true;
      void chrome.runtime
        .sendMessage({ type: 'PALI_PRIVACY_PROVER_CONNECT', id })
        .then((response) => {
          if (!response?.success && waitingPort === waiter)
            fail(new Error('privacy_proof_unavailable'));
        })
        .catch((error) => {
          if (waitingPort !== waiter) return;
          if (isMissingReceiver(error)) {
            connectSent = false;
            return;
          }
          fail(new Error('privacy_proof_unavailable'));
        });
    };
    const waiter = { id, accept, requestConnect };
    const deadline = setTimeout(
      () => fail(new Error('privacy_proof_unavailable')),
      10000
    );
    signal.addEventListener('abort', abort, { once: true });
    waitingPort = waiter;
    void ensureOffscreenDocument()
      .then(async () => {
        if (signal.aborted || waitingPort !== waiter) return;
        // Existing hosts answer this by emitting authenticated READY. For a cold
        // host that has not installed listeners yet, its startup READY resolves
        // readiness; a missing receiver here never triggers a timed retry.
        try {
          await chrome.runtime.sendMessage({
            type: 'PALI_PRIVACY_PROVER_READY_QUERY',
          });
        } catch (error) {
          if (waitingPort === waiter && !isMissingReceiver(error))
            fail(new Error('privacy_proof_unavailable'));
        }
      })
      .catch(() => {
        if (waitingPort === waiter)
          fail(new Error('privacy_proof_unavailable'));
      });
    if (signal.aborted) abort();
  });
}

export function cancelPrivacyProof(): void {
  active?.abort.abort();
}

/** Background-only API. Never expose its input through the UI controller. */
export async function runPrivacyProof(
  input: IPrivacyProofInput,
  options: IPrivacyProofOptions
): Promise<IPrivacyProofResult> {
  if (active) throw new Error('privacy_proof_busy');
  validatePrivacyProofInput(input);
  options.assertCurrent();
  const expected = privacyPublicSignals(input);
  const safeInput: IPrivacyProofInput = {
    root: input.root,
    nullifierHash: input.nullifierHash,
    recipient: input.recipient,
    relayer: input.relayer,
    fee: input.fee,
    refund: input.refund,
    nullifier: input.nullifier,
    secret: input.secret,
    pathElements: [...input.pathElements],
    pathIndices: [...input.pathIndices],
  };
  const job = { id: crypto.randomUUID(), abort: new AbortController() };
  active = job;
  const externalAbort = () => job.abort.abort();
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  const timeout = setTimeout(externalAbort, 120000);
  const guard = setInterval(() => {
    try {
      options.assertCurrent();
    } catch {
      job.abort.abort();
    }
  }, 250);
  let port: chrome.runtime.Port | undefined;
  try {
    if (options.signal?.aborted) job.abort.abort();
    port = await connect(job.abort.signal, job.id);
    options.assertCurrent();
    if (job.abort.signal.aborted) throw cancelled();
    const result = await new Promise<IPrivacyProofResult>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: IPrivacyProofResult) => {
        if (settled) return;
        settled = true;
        job.abort.signal.removeEventListener('abort', onAbort);
        port!.onMessage.removeListener(onMessage);
        port!.onDisconnect.removeListener(onDisconnect);
        if (error) reject(error);
        else resolve(value!);
      };
      const onAbort = () => finish(cancelled());
      const onDisconnect = () => finish(new Error('privacy_proof_unavailable'));
      const onMessage = (message: any) => {
        if (message?.id !== job.id || settled) return;
        try {
          options.assertCurrent();
          if (job.abort.signal.aborted) throw cancelled();
          if (message.type === 'progress') {
            const progress = message.progress as IPrivacyProofProgress;
            if (
              !progress ||
              !['artifacts', 'witness', 'proving', 'verifying'].includes(
                progress.stage
              ) ||
              (progress.completed !== undefined &&
                (!Number.isSafeInteger(progress.completed) ||
                  progress.completed < 0)) ||
              (progress.total !== undefined &&
                (!Number.isSafeInteger(progress.total) || progress.total < 0))
            )
              throw new Error();
            options.onProgress?.({
              stage: progress.stage,
              ...(progress.completed === undefined
                ? {}
                : { completed: progress.completed }),
              ...(progress.total === undefined
                ? {}
                : { total: progress.total }),
            });
            return;
          }
          const value = message.result;
          if (
            message.type !== 'success' ||
            !value ||
            typeof value.proof !== 'string' ||
            !/^0x[0-9a-f]{512}$/.test(value.proof) ||
            !Array.isArray(value.publicSignals) ||
            value.publicSignals.length !== 6 ||
            value.publicSignals.some(
              (s: unknown, i: number) => s !== expected[i]
            )
          )
            throw new Error();
          finish(undefined, {
            proof: value.proof,
            publicSignals: [...value.publicSignals],
          });
        } catch {
          finish(new Error('privacy_proof_failed'));
        }
      };
      job.abort.signal.addEventListener('abort', onAbort, { once: true });
      port!.onMessage.addListener(onMessage);
      port!.onDisconnect.addListener(onDisconnect);
      port!.postMessage({ type: 'prove', id: job.id, input: safeInput });
      if (job.abort.signal.aborted) onAbort();
    });
    options.assertCurrent();
    return result;
  } finally {
    clearTimeout(timeout);
    clearInterval(guard);
    options.signal?.removeEventListener('abort', externalAbort);
    safeInput.nullifier = '';
    safeInput.secret = '';
    if (port) {
      try {
        port.postMessage({ type: 'cancel' });
        port.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    if (active === job) active = undefined;
  }
}
