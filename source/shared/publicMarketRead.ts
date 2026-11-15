import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
} from './boundedHttp.ts';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type PendingRead = {
  controller: AbortController;
  promise: Promise<string>;
  settled: boolean;
  subscribers: number;
};
type ClientReads = { active: number; pending: Map<string, PendingRead> };
const clients = new WeakMap<FetchLike, ClientReads>();
const MAX_PENDING_MARKET_READS = 64;

/** Share only identical public market requests. Wallet identifiers never enter this map. */
export function readPublicMarketJson(
  fetcher: FetchLike,
  url: string,
  bytes: number,
  owner: AbortSignal
): Promise<unknown> {
  if (owner.aborted) return Promise.reject(new Error('Market read cancelled'));
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 2 * 1024 * 1024)
    return Promise.reject(new Error('Invalid market response limit'));
  const parsed = new URL(url);
  if (
    parsed.origin !== 'https://api.coingecko.com' ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !/^\/api\/v3\/coins\//.test(parsed.pathname)
  )
    return Promise.reject(new Error('Invalid market URL'));
  let client = clients.get(fetcher);
  if (!client) {
    client = { pending: new Map(), active: 0 };
    clients.set(fetcher, client);
  }
  const { pending } = client;
  const key = JSON.stringify([url, bytes]);
  let work = pending.get(key);
  if (!work || work.controller.signal.aborted) {
    if (client.active >= MAX_PENDING_MARKET_READS)
      return Promise.reject(new Error('Too many market reads'));
    const controller = new AbortController();
    const selected: PendingRead = {
      controller,
      subscribers: 0,
      settled: false,
      promise: Promise.resolve('null'),
    };
    pending.set(key, selected);
    const load = async () => {
      const timeout = setTimeout(() => controller.abort(), 8000);
      const signal = controller.signal;
      try {
        client.active++;
        const physical = (async () => {
          const response = await fetcher(url, {
            method: 'GET',
            signal,
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
          });
          if (
            signal.aborted ||
            !response.ok ||
            response.redirected ||
            (response.url && response.url !== url)
          ) {
            cancelResponseBody(response);
            throw new Error('Market unavailable');
          }
          const text = await boundedResponseText(response, signal, bytes);
          if (signal.aborted) throw new Error('Market read cancelled');
          JSON.parse(text);
          return text;
        })().finally(() => {
          client.active--;
        });
        return await abortable(physical, signal);
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    };
    selected.promise = load().finally(() => {
      selected.settled = true;
      if (pending.get(key) === selected) pending.delete(key);
    });
    work = selected;
  }
  const selected = work;
  selected.subscribers++;
  return new Promise((resolve, reject) => {
    let complete = false;
    const finish = (error: unknown, value?: unknown) => {
      if (complete) return;
      complete = true;
      owner.removeEventListener('abort', cancel);
      selected.subscribers--;
      if (!selected.subscribers && !selected.settled)
        selected.controller.abort();
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(new Error('Market read cancelled'));
    owner.addEventListener('abort', cancel, { once: true });
    selected.promise.then(
      (value) => {
        try {
          finish(null, JSON.parse(value));
        } catch (error) {
          finish(error);
        }
      },
      (error) => finish(error)
    );
  });
}
