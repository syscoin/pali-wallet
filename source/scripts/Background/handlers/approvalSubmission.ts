import {
  walletTokenReviewError,
  type WalletTokenReviewPayload,
} from '../../../shared/walletTokenReview';
import type { IEvmTransactionContext } from 'utils/evmTransactionContext';
import type {
  IUtxoSigningContext,
  UtxoDappSigningAuthority,
} from 'utils/utxoSigningContext';

import { isTrustedExtensionPageSender } from './internalMessageAuthorization';
import type { IReviewedEvmTokenApproval } from '@sidhujag/sysweb3-keyring';

export type TransactionApprovalDocument = Readonly<{
  assertCurrent: () => void;
  checkDocument: () => Promise<void>;
  getSignal: () => AbortSignal;
}>;

type DappEvmReview = TransactionApprovalDocument &
  Readonly<{ context: IEvmTransactionContext }>;

export type DappUtxoReview = TransactionApprovalDocument &
  Readonly<{
    context: IUtxoSigningContext;
    method: 'signSendAndSaveTransaction' | 'signSyscoinPsbt';
    psbt: Readonly<{
      assets: string;
      psbt: string;
      sentryFeeAuthorization?: string;
    }>;
  }>;

type Watch = {
  attempts: Set<object>;
  evmSend?: DappEvmReview;
  notify: (possible: boolean) => void;
  utxo?: DappUtxoReview;
};
const watches = new Map<string, Set<Watch>>();

/** Service-worker-local state for an already enrolled approval document. */
export const watchApprovalSubmission = (
  documentId: string,
  notify: Watch['notify'],
  evmSend?: DappEvmReview,
  utxo?: DappUtxoReview
): (() => void) => {
  const watch: Watch = {
    attempts: new Set(),
    evmSend:
      evmSend &&
      Object.freeze({
        ...evmSend,
        context: Object.freeze({
          ...evmSend.context,
          account: Object.freeze({ ...evmSend.context.account }),
        }),
      }),
    notify,
    utxo:
      utxo &&
      Object.freeze({
        ...utxo,
        context: Object.freeze({
          ...utxo.context,
          account: Object.freeze({ ...utxo.context.account }),
        }),
        psbt: Object.freeze({ ...utxo.psbt }),
      }),
  };
  const current = watches.get(documentId) || new Set<Watch>();
  current.add(watch);
  watches.set(documentId, current);
  return () => {
    current.delete(watch);
    if (!current.size) watches.delete(documentId);
  };
};

export const transactionApprovalExpired = () =>
  Object.assign(new Error('This transaction approval is no longer current.'), {
    transactionNotBroadcast: true,
  });

const captureApprovalDocument = (
  documentId: string,
  watch: Watch,
  review: TransactionApprovalDocument
) => {
  const signal = review.getSignal();
  const assertCurrent = () => {
    if (signal.aborted || !watches.get(documentId)?.has(watch))
      throw transactionApprovalExpired();
    review.assertCurrent();
  };
  assertCurrent();
  return {
    assertCurrent,
    signal,
    async checkDocument() {
      assertCurrent();
      await review.checkDocument();
      assertCurrent();
    },
  };
};

/** Bind an exact reviewed PSBT to its enrolled browser document and method. */
export const captureDappUtxoSubmission = (
  sender: chrome.runtime.MessageSender,
  method: DappUtxoReview['method'],
  input: { psbt?: DappUtxoReview['psbt'] } | undefined
) => {
  if (!isTrustedExtensionPageSender(sender) || !sender.documentId) return;
  const { documentId } = sender;
  const watch = [...(watches.get(documentId) || [])].find(
    (candidate) => candidate.utxo
  );
  if (!watch?.utxo) return;
  const review = watch.utxo;
  const { assertCurrent, checkDocument, signal } = captureApprovalDocument(
    documentId,
    watch,
    review
  );
  if (
    method !== review.method ||
    input?.psbt?.psbt !== review.psbt.psbt ||
    input.psbt.assets !== review.psbt.assets ||
    input.psbt.sentryFeeAuthorization !== review.psbt.sentryFeeAuthorization
  )
    throw transactionApprovalExpired();
  const authority: UtxoDappSigningAuthority = Object.freeze({
    assertCurrent,
    signal,
  });
  return {
    authority,
    checkDocument,
    input: { psbt: review.psbt, expectedContext: review.context },
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
  const { assertCurrent, checkDocument } = captureApprovalDocument(
    documentId,
    watch,
    watch.evmSend
  );
  return {
    context: watch.evmSend.context,
    assertCurrent,
    checkDocument,
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

type WalletTokenReviewAdmission = Readonly<{
  assertCurrent: () => void;
  payload: WalletTokenReviewPayload;
}>;
const WALLET_TOKEN_REVIEW_TTL_MS = 300_000;

export function watchWalletTokenReview(
  port: chrome.runtime.Port,
  capture: (
    request: unknown,
    persistentTab: boolean
  ) => WalletTokenReviewAdmission,
  submit: (
    payload: WalletTokenReviewPayload,
    approval: IReviewedEvmTokenApproval
  ) => Promise<{ hash: string }>,
  formatError: (error: unknown) => { error: unknown; success: boolean }
): void {
  const sender = port.sender;
  if (
    !sender?.url ||
    !isTrustedExtensionPageSender(sender) ||
    new URL(sender.url).pathname !== '/app.html'
  ) {
    port.disconnect();
    return;
  }

  const tabId = sender.tab?.id;
  const persistentTab =
    Number.isInteger(tabId) &&
    tabId >= 0 &&
    (sender.frameId === undefined || sender.frameId === 0);
  let phase: 'review' | 'submit' | 'submitted' | 'closed' = 'review';
  let approved: WalletTokenReviewAdmission;
  let expires: number;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const authority = new AbortController();
  const close = () => {
    phase = 'closed';
    clearTimeout(timeout);
    authority.abort();
  };
  port.onDisconnect.addListener(close);
  const reply = (value: unknown) => {
    if (phase === 'closed') return;
    try {
      port.postMessage(value);
    } catch {
      close();
    }
  };
  port.onMessage.addListener((message: unknown) => {
    if (phase === 'closed') return;
    if (phase === 'review') {
      try {
        approved = capture(message, persistentTab);
        expires = performance.now() + WALLET_TOKEN_REVIEW_TTL_MS;
        timeout = setTimeout(
          () => authority.abort(),
          WALLET_TOKEN_REVIEW_TTL_MS
        );
        phase = 'submit';
        reply({ type: 'reviewed' });
      } catch (error) {
        reply({ type: 'failure', ...formatError(error) });
        close();
      }
      return;
    }
    if (phase !== 'submit' || message !== 'submit') {
      close();
      port.disconnect();
      return;
    }
    phase = 'submitted';
    const assertCurrent = () => {
      if (
        phase !== 'submitted' ||
        authority.signal.aborted ||
        performance.now() >= expires
      )
        throw walletTokenReviewError();
      approved.assertCurrent();
    };
    void Promise.resolve()
      .then(() => {
        assertCurrent();
        return submit(
          approved.payload,
          Object.freeze({ assertCurrent, signal: authority.signal })
        );
      })
      .then(
        ({ hash }) => {
          // Preserve a known acknowledgement even if the approval expired
          // after the POST. A disconnected renderer reconciles its journal.
          reply({ type: 'submitted', hash });
          close();
        },
        (error) => {
          reply({ type: 'failure', ...formatError(error) });
          close();
        }
      );
  });
}
