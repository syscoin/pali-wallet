import { verifyOwnedUtxoRpc } from '@sidhujag/sysweb3-network/cjs/ownedUtxoRpc.js';

import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  checkAborted,
} from '../shared/boundedHttp.ts';

import { RAW_BYTES } from './utxoSignedBundle.ts';
import { snapshotUtxoSubmission } from './utxoSignedRecords.ts';
import type {
  UtxoDurableSubmission,
  UtxoRecordOwner,
  UtxoRecordSession,
  UtxoSignedRecords,
} from './utxoSignedRecords.ts';
import type { ISyscoinTransactions } from '@sidhujag/sysweb3-keyring';

const ACK_TIMEOUT_MS = 12_000;
const ACK_RECORD_WINDOW_MS = 5_000;
const ACK_BYTES = 16 * 1024;
const IDENTITY_TIMEOUT_MS = 10_000;
const IDENTITY_BYTES = 32 * 1024;
const STATUS_TIMEOUT_MS = 12_000;
const STATUS_BYTES = 2 * RAW_BYTES + 64 * 1024;

type UtxoSubmissionRequest = Readonly<{
  fetch: typeof globalThis.fetch;
  intent: 'initial' | 'replay';
  record: UtxoDurableSubmission;
  records: UtxoSignedRecords;
  session: UtxoRecordSession;
}>;

type SubmissionAuthority = Parameters<
  ISyscoinTransactions['sendTransaction']
>[1];
type SubmissionResult = ReturnType<ISyscoinTransactions['sendTransaction']>;

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
  if (!response.ok || response.redirected || response.url !== url) {
    cancelResponseBody(response);
    throw new Error('Blockbook submission response is unavailable');
  }
  const text = await boundedResponseText(response, signal, ACK_BYTES);
  const bounded = new Response(text, { status: response.status });
  Object.defineProperty(bounded, 'url', { value: response.url });
  return bounded;
}

function sameOwner(
  a: UtxoDurableSubmission['owner'],
  b: UtxoDurableSubmission['owner']
): boolean {
  return (
    a.chainId === b.chainId &&
    a.slip44 === b.slip44 &&
    a.genesisHash === b.genesisHash &&
    a.account.id === b.account.id &&
    a.account.type === b.account.type &&
    a.account.xpub === b.account.xpub
  );
}

async function readRetainedJson(
  fetch: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal,
  assertCurrent: () => void,
  maxBytes: number
): Promise<unknown> {
  const pending = fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
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

/** Explicit saved-transfer status check. Only the authenticated original route can answer. */
export function observeRetainedUtxo({
  records,
  session,
  owner,
  txid,
  backendChain,
  fetch,
  signal,
}: Readonly<{
  backendChain: string;
  fetch: typeof globalThis.fetch;
  owner: UtxoRecordOwner;
  records: UtxoSignedRecords;
  session: UtxoRecordSession;
  signal: AbortSignal;
  txid: string;
}>) {
  return records.observeRetained(
    {
      ...session,
      assertCurrent() {
        checkAborted(signal);
        session.assertCurrent();
        checkAborted(signal);
      },
    },
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
            return readRetainedJson(fetch, url, owned, guard, IDENTITY_BYTES);
          },
        });
        if (verified.coin.hashGenesisBlock !== retained.owner.genesisHash)
          throw new Error('Retained UTXO network changed');
        verified.assertCurrent();
        return await readRetainedJson(
          fetch,
          statusUrl + 'tx/' + retained.txid,
          owned,
          verified.assertCurrent,
          STATUS_BYTES
        );
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        abort();
      }
    }
  );
}

/** A new send persists its exact signed bytes. */
export function submitReviewedUtxo({
  sender,
  ...request
}: Omit<UtxoSubmissionRequest, 'intent'> &
  Readonly<{ sender: Pick<ISyscoinTransactions, 'sendTransaction'> }>) {
  return submitUtxo({ ...request, intent: 'initial' }, (record, authority) =>
    sender.sendTransaction(record.rawTransaction, authority)
  );
}

/** Replay through the SDK's mandatory original-route verifier. */
export function submitRetainedUtxo({
  sender,
  ...request
}: Omit<UtxoSubmissionRequest, 'intent'> &
  Readonly<{
    sender: Pick<ISyscoinTransactions, 'replayRetainedTransaction'>;
  }>) {
  return submitUtxo(
    { ...request, intent: 'replay' },
    async (record, authority) => {
      const controller = new AbortController();
      const { signal } = controller;
      const abort = () => controller.abort();
      authority.signal.addEventListener('abort', abort, { once: true });
      if (authority.signal.aborted) abort();
      const assertCurrent = () => {
        checkAborted(signal);
        authority.assertCurrent();
        checkAborted(signal);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let statusUrl: string;
      let stage:
        | 'journal'
        | 'checking'
        | 'status'
        | 'genesis'
        | 'ready'
        | 'admission' = 'journal';
      try {
        assertCurrent();
        return await sender.replayRetainedTransaction(record.txid, {
          ...authority,
          async readRetained(owner, txid) {
            assertCurrent();
            if (
              stage !== 'journal' ||
              txid !== record.txid ||
              !sameOwner(owner, record.owner)
            )
              return undefined;
            stage = 'checking';
            const retained = await request.records.readExact(
              request.session,
              record.owner,
              record.txid
            );
            assertCurrent();
            if (
              !retained ||
              retained.url !== record.url ||
              retained.rawTransaction !== record.rawTransaction
            )
              return undefined;
            // The journal validates the canonical /api/v2/sendtx/ suffix. Only its
            // two adjacent identity paths can use the read port for this replay.
            statusUrl = retained.url.slice(0, -'sendtx/'.length);
            stage = 'status';
            timer = setTimeout(abort, IDENTITY_TIMEOUT_MS);
            return retained;
          },
          async readJson(url, ownerSignal) {
            assertCurrent();
            const isStatus = stage === 'status';
            if (
              ownerSignal !== authority.signal ||
              (!isStatus && stage !== 'genesis') ||
              url !== (isStatus ? statusUrl : statusUrl + 'block-index/0')
            )
              throw new Error('Invalid retained UTXO identity read');
            stage = 'checking';
            const body = await readRetainedJson(
              request.fetch,
              url,
              signal,
              assertCurrent,
              IDENTITY_BYTES
            );
            stage = isStatus ? 'genesis' : 'ready';
            return body;
          },
          async prepare(descriptor) {
            assertCurrent();
            if (stage !== 'ready')
              throw new Error('Retained UTXO route was not verified');
            stage = 'admission';
            clearTimeout(timer);
            await authority.prepare(descriptor);
          },
        });
      } finally {
        clearTimeout(timer);
        authority.signal.removeEventListener('abort', abort);
        abort();
      }
    }
  );
}

async function submitUtxo(
  { record: candidate, records, session, fetch, intent }: UtxoSubmissionRequest,
  dispatch: (
    record: UtxoDurableSubmission,
    authority: SubmissionAuthority
  ) => SubmissionResult
) {
  const record = snapshotUtxoSubmission(candidate);
  const { rawTransaction, txid, url, owner } = record;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let admitted = false;
  let preparing = false;
  let attempted = false;
  let admissionFailure: unknown;
  try {
    const ack = await records.admit(
      session,
      record,
      intent,
      (prepare, release) =>
        dispatch(record, {
          signal: controller.signal,
          assertCurrent: session.assertCurrent,
          async prepare(received) {
            try {
              if (
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
              !admitted ||
              attempted ||
              input !== url ||
              init?.method !== 'POST' ||
              init.body !== rawTransaction ||
              init.signal !== controller.signal
            )
              throw new Error('Invalid owned UTXO POST');
            // Revocation after dispatch does not erase a matching network ACK.
            session.assertCurrent();
            attempted = true;
            timer = setTimeout(() => controller.abort(), ACK_TIMEOUT_MS);
            const pending = post(fetch, url, rawTransaction, controller.signal);
            release();
            return pending;
          },
        })
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
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}
