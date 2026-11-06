import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  ResponseSizeLimitError,
} from '../shared/boundedHttp.ts';
import { UTXO_DETAIL_RESPONSE_BYTES } from '../shared/utxoTransactionDetailCache.ts';

export type UtxoBlockbookReadScope =
  | Readonly<{ kind: 'fee'; url: string }>
  | Readonly<{ kind: 'detail'; txid: string; url: string }>
  | Readonly<{ address: string; kind: 'wallet'; url: string; xpub: string }>;

const RESPONSE_BYTES = 1024 * 1024;
const OPERATION_BYTES = RESPONSE_BYTES * 2;
const READ_TIMEOUT_MS = 12_000;
const FEE = '/api/v2/estimatefee/1';

/** A background-owned Blockbook GET port for one captured wallet read. */
export function createOwnedUtxoBlockbookRead(
  scope: UtxoBlockbookReadScope,
  signal: AbortSignal,
  assertCurrent: () => void,
  transport: typeof globalThis.fetch
) {
  const endpoint = new URL(scope.url);
  if (
    (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') ||
    endpoint.username ||
    endpoint.password ||
    /[?#]/.test(endpoint.href)
  )
    throw new Error('Invalid owned Blockbook endpoint');
  const base = endpoint.href.replace(/\/$/, '');
  const allowed = new Set<string>();
  if (scope.kind === 'detail') {
    if (!/^[a-f0-9]{64}$/.test(scope.txid))
      throw new Error('Invalid owned Blockbook transaction');
    allowed.add(`/api/v2/tx/${scope.txid}`);
  } else {
    allowed.add(FEE);
  }
  if (scope.kind === 'wallet') {
    if (scope.address)
      allowed.add(`/api/v2/utxo/${encodeURIComponent(scope.address)}`);
    if (scope.xpub) {
      const xpub = encodeURIComponent(scope.xpub);
      allowed.add(`/api/v2/utxo/${xpub}`);
      allowed.add(`/api/v2/xpub/${xpub}?tokens=used&details=tokens`);
    }
  }
  const wallet = scope.kind === 'wallet';
  let consumed = 0;
  const check = () => {
    assertCurrent();
    if (signal.aborted) throw new Error('Wallet UTXO read was cancelled');
  };
  check();

  async function read(url: string) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, READ_TIMEOUT_MS);
    try {
      check();
      const pending = transport(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      }).then((response) => {
        if (controller.signal.aborted) cancelResponseBody(response);
        return response;
      });
      const response = await abortable(pending, controller.signal);
      check();
      if (response.redirected || response.url !== url) {
        cancelResponseBody(response);
        throw new Error('Blockbook response does not match the owned endpoint');
      }
      if (!response.ok) {
        cancelResponseBody(response);
        return { body: null, status: response.status };
      }
      if (
        scope.kind === 'detail' &&
        (!response.body?.getReader || typeof TextDecoder === 'undefined')
      ) {
        cancelResponseBody(response);
        throw new Error('Blockbook transaction requires a readable stream');
      }
      const body = await boundedResponseText(
        response,
        controller.signal,
        scope.kind === 'detail' ? UTXO_DETAIL_RESPONSE_BYTES : RESPONSE_BYTES,
        (bytes) => {
          consumed += bytes;
          if (consumed > OPERATION_BYTES) throw new ResponseSizeLimitError();
        }
      );
      check();
      return { body, status: response.status };
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      controller.abort();
    }
  }

  // Prevout verification and hardware enrichment share one bounded response.
  // Keep the body, not a Response stream, so each caller can consume it once.
  const rawReads = new Map<string, ReturnType<typeof read>>();
  signal.addEventListener('abort', () => rawReads.clear(), { once: true });

  return Object.freeze({
    signal,
    assertCurrent: check,
    async fetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      check();
      if (
        typeof input !== 'string' ||
        init?.method !== 'GET' ||
        init.signal !== signal
      )
        throw new Error('Invalid owned Blockbook request');
      const url = new URL(input).href;
      if (!url.startsWith(base + '/'))
        throw new Error('Invalid owned Blockbook endpoint');
      const path = url.slice(base.length);
      const txid = /^\/api\/v2\/tx\/([0-9a-f]{64})$/.exec(path)?.[1];
      if (!allowed.has(path) && !(wallet && txid))
        throw new Error('Invalid owned Blockbook route');

      let pending = txid ? rawReads.get(txid) : undefined;
      if (!pending) {
        pending = txid ? Promise.resolve().then(() => read(url)) : read(url);
        if (txid) {
          rawReads.set(txid, pending);
          const forget = () => rawReads.delete(txid);
          void pending.then(({ body }) => {
            if (!body) forget();
          }, forget);
        }
      }
      const { body, status } = await pending;
      check();
      return new Response(body, { status });
    },
  });
}
