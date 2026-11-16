import * as sys from 'syscoinjs-lib';

import {
  boundedResponseText,
  cancelResponseBody,
} from '../../../../shared/boundedHttp';

type AccountRequest = {
  abortController: AbortController;
  details: string;
  detailsLevel: number;
  promise: Promise<any>;
  scopeKey: string;
  settled: boolean;
  subscribers: number;
};
const requestCache = new Map<string, AccountRequest>();
const REQUEST_TIMEOUT_MS = 30_000;
const ACCOUNT_RESPONSE_BYTES = 2 * 1024 * 1024;

const cancelled = () =>
  Object.assign(new Error('Request was cancelled'), { name: 'AbortError' });

function subscribe(entry: AccountRequest, signal?: AbortSignal): Promise<any> {
  entry.subscribers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (complete: () => void) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      entry.abortController.signal.removeEventListener('abort', abort);
      entry.subscribers--;
      if (!entry.settled && !entry.subscribers) entry.abortController.abort();
      complete();
    };
    const abort = () => done(() => reject(cancelled()));
    signal?.addEventListener('abort', abort, { once: true });
    entry.abortController.signal.addEventListener('abort', abort, {
      once: true,
    });
    if (signal?.aborted || entry.abortController.signal.aborted) abort();
    entry.promise.then(
      (value) => done(() => resolve(value)),
      (error) => done(() => reject(error))
    );
  });
}

// Blockbook `details=` levels are strictly cumulative: every level includes the
// summary fields (balance, unconfirmedBalance, txs, unconfirmedTxs, ...) that a
// `details=basic` response carries. This lets a basic request piggyback on any
// in-flight higher-level request for the same xpub/address.
const DETAILS_LEVEL_RANK: Record<string, number> = {
  basic: 1,
  tokens: 2,
  tokenBalances: 3,
  txids: 4,
  txsummary: 5,
  txslight: 6,
  txs: 7,
};

const BASIC_LEVEL = DETAILS_LEVEL_RANK.basic;

const parseDetails = (requestOptions: string): string => {
  const match = /(?:^|&)details=([^&]*)/.exec(requestOptions);
  // Blockbook defaults to txids when details is omitted
  return match ? match[1] : 'txids';
};

const parseDetailsLevel = (requestOptions: string): number =>
  DETAILS_LEVEL_RANK[parseDetails(requestOptions)] ?? 0;

// Scope key identifies the account being queried, regardless of detail options
const createScopeKey = (
  networkUrl: string,
  xpubOrAddress: string,
  isXpub: boolean
): string =>
  `${networkUrl.replace(/\/$/, '')}::${
    isXpub ? 'xpub' : 'addr'
  }::${xpubOrAddress}`;

// Create a unique key for the request
const createRequestKey = (scopeKey: string, requestOptions: string): string =>
  `${scopeKey}::${requestOptions}`;

/**
 * Wrapper around sys.utils.fetchBackendAccount that provides request deduplication
 * This prevents multiple identical requests from being made simultaneously.
 *
 * It is also level-aware: a `details=basic` request is satisfied by any in-flight
 * request for the same xpub/address at a higher detail level (Blockbook levels are
 * cumulative), consolidating the balance fetch with the heavier transaction/token
 * fetches fired in the same poll cycle.
 */
export const fetchBackendAccountCached = async (
  networkUrl: string,
  xpubOrAddress: string,
  requestOptions: string,
  _parseData: boolean,
  signal?: AbortSignal
): Promise<any> => {
  if (signal?.aborted) throw cancelled();

  // Detect whether the identifier is an XPUB-like or descriptor; descriptors use xpub endpoint
  const looksLikeXpub = /^(xpub|tpub|zpub|vpub)/i.test(xpubOrAddress);
  const looksLikeDescriptor =
    /^(addr|pkh|wpkh|sh|wsh|tr|combo|multi|sortedmulti)\s*\(/i.test(
      xpubOrAddress
    );
  const isXpub = looksLikeXpub || looksLikeDescriptor;

  const scopeKey = createScopeKey(networkUrl, xpubOrAddress, isXpub);
  const cacheKey = createRequestKey(scopeKey, requestOptions);
  const details = parseDetails(requestOptions);
  const detailsLevel = parseDetailsLevel(requestOptions);

  // Check if we have an in-flight request for the same parameters
  const cachedEntry = requestCache.get(cacheKey);
  if (cachedEntry) {
    console.log(
      `[fetchBackendAccountWrapper] Using in-flight request for ${cacheKey}`
    );
    if (!cachedEntry.abortController.signal.aborted)
      return subscribe(cachedEntry, signal);
    requestCache.delete(cacheKey);
  }

  // Level-aware reuse: a basic request only needs the summary fields, which every
  // Blockbook response includes, so any in-flight request for this account works.
  if (detailsLevel === BASIC_LEVEL) {
    for (const entry of requestCache.values()) {
      if (
        entry.scopeKey === scopeKey &&
        entry.detailsLevel >= BASIC_LEVEL &&
        entry.details !== 'txsummary' &&
        !entry.abortController.signal.aborted
      ) {
        console.log(
          `[fetchBackendAccountWrapper] Satisfying basic request from in-flight higher-level request for ${scopeKey}`
        );
        return subscribe(entry, signal);
      }
    }
  }

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
  const requestPromise = sys.utils
    .fetchBackendAccount(
      networkUrl,
      xpubOrAddress,
      requestOptions,
      isXpub,
      undefined,
      {
        signal: abortController.signal,
        fetch: async (url: string, init: RequestInit) => {
          const requested = new URL(url);
          if (
            !['http:', 'https:'].includes(requested.protocol) ||
            requested.username ||
            requested.password ||
            requested.hash
          )
            throw new Error('Invalid Blockbook endpoint');
          const response = await fetch(url, {
            ...init,
            signal: abortController.signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
          });
          try {
            if (abortController.signal.aborted) throw cancelled();
            if (
              response.redirected ||
              (response.status >= 300 && response.status < 400) ||
              (response.url && new URL(response.url).href !== requested.href)
            )
              throw new Error('Blockbook response endpoint changed');
            if (!response.ok) {
              cancelResponseBody(response);
              return response;
            }
            const text = await boundedResponseText(
              response,
              abortController.signal,
              ACCOUNT_RESPONSE_BYTES
            );
            if (abortController.signal.aborted) throw cancelled();
            let data: unknown;
            try {
              data = JSON.parse(text);
            } catch {
              // The SDK matches error text for retries. Keep body content out of it.
              throw new Error('Invalid Blockbook response');
            }
            // The pinned SDK consumes only these fields; its parser receives
            // data admitted through the byte limit and the same physical owner.
            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              json: async () => data,
            };
          } catch (error) {
            cancelResponseBody(response);
            throw error;
          }
        },
      }
    )
    .then((value: any) => {
      if (abortController.signal.aborted) throw cancelled();
      return value;
    });
  const entry: AccountRequest = {
    abortController,
    details,
    detailsLevel,
    promise: requestPromise,
    scopeKey,
    settled: false,
    subscribers: 0,
  };
  requestCache.set(cacheKey, entry);
  abortController.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      if (requestCache.get(cacheKey) === entry) requestCache.delete(cacheKey);
    },
    { once: true }
  );
  void requestPromise
    .finally(() => {
      clearTimeout(timer);
      entry.settled = true;
      // Only completed results have a short reuse lifetime. Pending work keeps
      // its owner until completion, cancellation or its physical deadline.
      setTimeout(() => {
        if (requestCache.get(cacheKey) === entry) requestCache.delete(cacheKey);
      }, 100);
    })
    .catch(() => undefined);
  return subscribe(entry, signal);
};

/** Retiring a context cancels work; refreshing values only invalidates completed observations. */
export const clearFetchBackendAccountCache = (completedOnly = false) => {
  for (const [key, entry] of requestCache) {
    if (completedOnly && !entry.settled) continue;
    entry.abortController.abort();
    requestCache.delete(key);
  }
};
