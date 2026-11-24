import { verifyOwnedUtxoRpc } from '@sidhujag/sysweb3-network/cjs/ownedUtxoRpc.js';

import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  checkAborted,
} from '../shared/boundedHttp.ts';
import type { UtxoActivityReplacement } from '../shared/utxoActivityStatus.ts';

import { fetchUtxoRead } from './utxoReadRetry.ts';
import { HASH, RAW_BYTES } from './utxoSignedBundle.ts';
import {
  matchesUtxoSignedDigest,
  snapshotUtxoSubmission,
} from './utxoSignedRecords.ts';
import type {
  UtxoDurableSubmission,
  UtxoRecordOwner,
  UtxoRecordSession,
  UtxoRetainedSubmission,
  UtxoSignedRecords,
} from './utxoSignedRecords.ts';
import type { ISyscoinTransactions } from '@sidhujag/sysweb3-keyring';

const ACK_TIMEOUT_MS = 12_000;
const ACK_RECORD_WINDOW_MS = 5_000;
const ACK_BYTES = 16 * 1024;
const IDENTITY_BYTES = 32 * 1024;
const STATUS_TIMEOUT_MS = 12_000;
const STATUS_BYTES = 2 * RAW_BYTES + 64 * 1024;

type UtxoSubmissionRequest = Readonly<{
  fetch: typeof globalThis.fetch;
  record: UtxoDurableSubmission;
  records: UtxoSignedRecords;
  session: UtxoRecordSession;
  signal?: AbortSignal;
}>;

export type UtxoSubmissionDisposition =
  | Readonly<{ transactionNotBroadcast: true }>
  | Readonly<{ transactionNotBroadcast: false; txid: string }>;

/** Request retirement cannot turn an actual POST back into a safe cancellation. */
export function createUtxoSubmissionDisposition() {
  let disposition: UtxoSubmissionDisposition = Object.freeze({
    transactionNotBroadcast: true,
  });
  return Object.freeze({
    read: () => disposition,
    trackPost(
      candidate: UtxoDurableSubmission,
      transport: typeof globalThis.fetch
    ): typeof globalThis.fetch {
      const { url, rawTransaction, txid } = snapshotUtxoSubmission(candidate);
      return (input, init) => {
        if (
          !disposition.transactionNotBroadcast ||
          input !== url ||
          init?.method !== 'POST' ||
          init.body !== rawTransaction
        )
          throw new Error('Invalid owned UTXO POST');
        disposition = Object.freeze({ transactionNotBroadcast: false, txid });
        return transport(input, init);
      };
    },
  });
}

function submissionError(
  code: string,
  message: string,
  noPost: boolean,
  txid?: string
) {
  return Object.assign(new Error(message), {
    code,
    transactionNotBroadcast: noPost,
    ...(txid ? { txid } : {}),
  });
}

/** The SDK owns exact ACK interpretation. This port only bounds the HTTP exchange. */
async function post(
  transport: typeof globalThis.fetch,
  url: string,
  raw: string,
  signal: AbortSignal
): Promise<Response> {
  const pending = transport(url, {
    method: 'POST',
    body: raw,
    signal,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  }).then((response) => {
    if (signal.aborted) cancelResponseBody(response);
    return response;
  });
  const response = await abortable(pending, signal);
  if (!response.ok || response.redirected !== false || response.url !== url) {
    cancelResponseBody(response);
    throw new Error('Blockbook submission response is unavailable');
  }
  const text = await boundedResponseText(response, signal, ACK_BYTES);
  const bounded = new Response(text, { status: response.status });
  // React Native's Response constructor does not initialize redirected.
  Object.defineProperties(bounded, {
    url: { value: url },
    redirected: { value: false },
  });
  return bounded;
}

async function readRetainedJson(
  fetch: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal,
  assertCurrent: () => void,
  maxBytes: number,
  deadline: number
): Promise<unknown> {
  const response = await fetchUtxoRead(
    fetch,
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    },
    assertCurrent,
    deadline
  );
  try {
    assertCurrent();
    if (
      !response.ok ||
      response.redirected !== false ||
      response.url !== url ||
      !response.body?.getReader ||
      typeof TextDecoder === 'undefined'
    )
      throw new Error('Retained UTXO response is unavailable');
    const text = await boundedResponseText(response, signal, maxBytes);
    assertCurrent();
    return JSON.parse(text);
  } catch (error) {
    cancelResponseBody(response);
    throw error;
  }
}

/** Saved-transfer status check. Only the authenticated original route can answer. */
export function observeRetainedUtxo({
  records,
  session,
  owner,
  txid,
  backendChain,
  fetch,
  signal,
  onReplacementObservation,
}: Readonly<{
  backendChain: string;
  fetch: typeof globalThis.fetch;
  owner: UtxoRecordOwner;
  records: UtxoSignedRecords;
  session: UtxoRecordSession;
  signal: AbortSignal;
  txid: string;
  onReplacementObservation?: (
    txid: string,
    replacement: UtxoActivityReplacement | undefined
  ) => void;
}>) {
  const currentSession = {
    ...session,
    assertCurrent() {
      checkAborted(signal);
      session.assertCurrent();
      checkAborted(signal);
    },
  };
  let canonical:
    | { record: UtxoRetainedSubmission; blockHash: string }
    | undefined;
  return records.observeRetained(
    currentSession,
    owner,
    txid,
    async (retained, assertCurrent) => {
      const statusUrl = retained.url.slice(0, -'sendtx/'.length);
      const genesisUrl = statusUrl + 'block-index/0';
      const prefix = statusUrl.slice(0, -'/api/v2/'.length);
      // The SDK strips one trailing slash. Preserve any slash in the saved prefix.
      const base = prefix.endsWith('/') ? prefix + '/' : prefix;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, STATUS_TIMEOUT_MS);
      const deadline = Date.now() + STATUS_TIMEOUT_MS;
      const owned = controller.signal;
      const guard = () => {
        assertCurrent();
        checkAborted(owned);
      };
      try {
        guard();
        const verified = await verifyOwnedUtxoRpc(base, {
          registration: {
            chainId: retained.owner.chainId,
            slip44: retained.owner.slip44,
          },
          backendChain,
          assertCurrent: guard,
          signal: owned,
          readJson(url, identitySignal) {
            if (
              identitySignal !== owned ||
              (url !== statusUrl && url !== genesisUrl)
            )
              throw new Error('Invalid retained UTXO identity read');
            return readRetainedJson(
              fetch,
              url,
              owned,
              guard,
              IDENTITY_BYTES,
              deadline
            );
          },
        });
        if (verified.coin.hashGenesisBlock !== retained.owner.genesisHash)
          throw new Error('Retained UTXO network changed');
        verified.assertCurrent();
        const transaction = await readRetainedJson(
          fetch,
          statusUrl + 'tx/' + retained.txid,
          owned,
          verified.assertCurrent,
          STATUS_BYTES,
          deadline
        );
        if (onReplacementObservation && retained.replacementOf) {
          const observed = transaction as {
            txid?: unknown;
            hex?: unknown;
            confirmations?: number;
            blockHash?: string;
            blockHeight?: number;
          } | null;
          if (
            observed?.txid === retained.txid &&
            matchesUtxoSignedDigest(retained, observed.hex) &&
            Number.isSafeInteger(observed.confirmations) &&
            observed.confirmations! > 0 &&
            typeof observed.blockHash === 'string' &&
            HASH.test(observed.blockHash) &&
            Number.isSafeInteger(observed.blockHeight) &&
            observed.blockHeight! > 0
          ) {
            // Keep canonicality checks for presentation independent of the
            // existing exact-byte journal observation and its phase policy.
            const block = (await readRetainedJson(
              fetch,
              statusUrl + 'block-index/' + observed.blockHeight,
              owned,
              verified.assertCurrent,
              IDENTITY_BYTES,
              deadline
            ).catch(() => null)) as { blockHash?: unknown } | null;
            if (block?.blockHash === observed.blockHash)
              canonical = { record: retained, blockHash: observed.blockHash };
          }
        }
        return transaction;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        abort();
      }
    },
    onReplacementObservation &&
      (async (status, observation) => {
        let replacement: UtxoActivityReplacement | undefined;
        if (status === 'confirmed' && canonical) {
          const { record, blockHash } = canonical;
          const replacedTxids = await records
            .activityReplacementAncestors(observation, owner, record)
            .catch(() => []);
          if (replacedTxids.length) replacement = { blockHash, replacedTxids };
        }
        observation.assertCurrent();
        onReplacementObservation(txid, replacement);
      })
  );
}

/** Shared active-wallet refresh: at most two original-route checks per pass.
 * It uses the same exact-byte observation as an explicit recovery status check. */
export function reconcileRetainedUtxo(
  request: Omit<Parameters<typeof observeRetainedUtxo>[0], 'txid'>
): Promise<void> {
  const session = {
    ...request.session,
    assertCurrent() {
      checkAborted(request.signal);
      request.session.assertCurrent();
      checkAborted(request.signal);
    },
  };
  return request.records.reconcile(session, request.owner, (txid) =>
    observeRetainedUtxo({ ...request, session, txid })
  );
}

/** Submit an approved transfer after durable admission. */
export async function submitReviewedUtxo({
  record: candidate,
  records,
  session,
  fetch,
  signal,
  sender,
}: UtxoSubmissionRequest &
  Readonly<{ sender: Pick<ISyscoinTransactions, 'sendTransaction'> }>) {
  const record = snapshotUtxoSubmission(candidate);
  const { rawTransaction, txid, url, owner } = record;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const assertCurrent = () => {
    checkAborted(controller.signal);
    session.assertCurrent();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let admitted = false;
  let preparing = false;
  let attempted = false;
  let dispatchClosed = false;
  let admissionFailure: unknown;
  try {
    assertCurrent();
    const ack = await records.admit(
      session,
      record,
      async (prepare, release) => {
        try {
          return await sender.sendTransaction(rawTransaction, {
            signal: controller.signal,
            assertCurrent,
            async prepare(received) {
              try {
                assertCurrent();
                if (
                  dispatchClosed ||
                  preparing ||
                  received.url !== url ||
                  received.txid !== txid ||
                  received.rawTransaction !== rawTransaction
                )
                  throw new Error(
                    'Submission differs from the reviewed signed transaction'
                  );
                preparing = true;
                await prepare();
                admitted = true;
              } catch (error) {
                admissionFailure = error;
                throw error;
              }
            },
            async fetch(input, init) {
              if (
                dispatchClosed ||
                !admitted ||
                attempted ||
                input !== url ||
                init?.method !== 'POST' ||
                init.body !== rawTransaction ||
                init.signal !== controller.signal
              )
                throw new Error('Invalid owned UTXO POST');
              // Revocation after dispatch does not erase a matching network ACK.
              assertCurrent();
              signal?.removeEventListener('abort', abort);
              attempted = true;
              timer = setTimeout(() => controller.abort(), ACK_TIMEOUT_MS);
              const pending = post(
                fetch,
                url,
                rawTransaction,
                controller.signal
              );
              release();
              return pending;
            },
          });
        } finally {
          dispatchClosed = true;
        }
      }
    );
    if (!admitted || !attempted || ack.txid !== txid)
      throw new Error('Invalid UTXO submission acknowledgment');
    // The network ACK is already authoritative. Keep a held SQL/Chrome write
    // outside the request lifetime and expire its owner at the commit barrier.
    const deadline = performance.now() + ACK_RECORD_WINDOW_MS;
    void records
      .acknowledge(
        {
          ...session,
          assertCurrent() {
            if (performance.now() >= deadline)
              throw new Error('UTXO acknowledgment record expired');
            return session.assertCurrent();
          },
        },
        owner,
        txid
      )
      .catch(() => undefined);
    return Object.freeze({ txid });
  } catch {
    if (attempted)
      throw submissionError(
        'UTXO_SUBMISSION_UNKNOWN',
        'Transaction submission could not be verified.',
        false,
        txid
      );
    if (
      admissionFailure instanceof Error &&
      admissionFailure.message.startsWith('UTXO_SIGNED_')
    )
      throw submissionError(
        admissionFailure.message,
        'Transaction could not be safely saved for submission.',
        true
      );
    throw submissionError(
      'UTXO_SUBMISSION_NOT_DISPATCHED',
      'Transaction was not sent.',
      true,
      admitted ? txid : undefined
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
