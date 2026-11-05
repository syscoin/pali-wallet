import type { IEvmTransactionContext } from 'utils/evmTransactionContext';

import { isTrustedExtensionPageSender } from './internalMessageAuthorization';

type Watch = {
  attempts: Set<object>;
  evmSend?: IEvmTransactionContext;
  notify: (possible: boolean) => void;
};
const watches = new Map<string, Set<Watch>>();

/** Service-worker-local state for an already enrolled approval document. */
export const watchApprovalSubmission = (
  documentId: string,
  notify: Watch['notify'],
  evmSend?: IEvmTransactionContext
): (() => void) => {
  const watch: Watch = {
    attempts: new Set(),
    evmSend:
      evmSend &&
      Object.freeze({
        ...evmSend,
        account: Object.freeze({ ...evmSend.account }),
      }),
    notify,
  };
  const current = watches.get(documentId) || new Set<Watch>();
  current.add(watch);
  watches.set(documentId, current);
  return () => {
    current.delete(watch);
    if (!current.size) watches.delete(documentId);
  };
};

/** Only the browser's enrolled transaction approval document can enter this lane. */
export const captureDappEvmSubmission = (
  sender: chrome.runtime.MessageSender
) => {
  if (!isTrustedExtensionPageSender(sender) || !sender.documentId) return;
  const { documentId } = sender;
  const watch = [...(watches.get(documentId) || [])].find(
    (candidate) => candidate.evmSend
  );
  if (!watch?.evmSend) return;
  return {
    context: watch.evmSend,
    assertCurrent: () => {
      if (!watches.get(documentId)?.has(watch))
        throw new Error('This transaction approval is no longer current.');
    },
  };
};

/** Called only around the actual trusted controller invocation, never by a dapp. */
export const beginApprovalSubmission = (
  sender: chrome.runtime.MessageSender,
  methods: unknown
): ((error?: unknown) => void) => {
  if (
    !isTrustedExtensionPageSender(sender) ||
    !sender.documentId ||
    !Array.isArray(methods) ||
    methods.length !== 2 ||
    methods[0] !== 'wallet' ||
    ![
      'sendAndSaveEthTransaction',
      'submitSmartAccountExecution',
      'registerSmartAccountOnChain',
      'signSendAndSaveTransaction',
    ].includes(methods[1])
  )
    return () => undefined;
  // Chrome's document id was enrolled with the popup's window identity. Later
  // native extension messages may omit tab/frame metadata; the id stays bound.
  const current = [...(watches.get(sender.documentId) || [])];
  const attempt = {};
  for (const watch of current) {
    watch.attempts.add(attempt);
    watch.notify(true);
  }
  let completed = false;
  return (error?: unknown) => {
    if (completed) return;
    completed = true;
    if (
      (error as { transactionNotBroadcast?: unknown })
        ?.transactionNotBroadcast !== true
    )
      return;
    for (const watch of current) {
      watch.attempts.delete(attempt);
      watch.notify(watch.attempts.size > 0);
    }
  };
};
