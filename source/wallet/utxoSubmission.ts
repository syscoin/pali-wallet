import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
} from '../shared/boundedHttp.ts';

import { snapshotUtxoSubmission } from './utxoSignedRecords.ts';
import type {
  UtxoDurableSubmission,
  UtxoRecordSession,
  UtxoSignedRecords,
} from './utxoSignedRecords.ts';
import type { ISyscoinTransactions } from '@sidhujag/sysweb3-keyring';

const ACK_TIMEOUT_MS = 12_000;
const ACK_RECORD_WINDOW_MS = 5_000;
const ACK_BYTES = 16 * 1024;

type UtxoSubmissionRequest = Readonly<{
  fetch: typeof globalThis.fetch;
  intent: 'initial' | 'replay';
  record: UtxoDurableSubmission;
  records: UtxoSignedRecords;
  sender: Pick<ISyscoinTransactions, 'sendTransaction'>;
  session: UtxoRecordSession;
}>;

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

/** A new send persists its exact signed bytes. A retry can only replay an authenticated record. */
export async function submitReviewedUtxo({
  record: candidate,
  sender,
  records,
  session,
  fetch,
  intent,
}: UtxoSubmissionRequest) {
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
        sender.sendTransaction(rawTransaction, {
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
