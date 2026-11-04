import { buildAccountHistoryUrl } from '../../../../source/shared/evmExplorer.ts';
import { boundedResponseText, parseRpcQuantity } from '../platformRpc.ts';
import {
  ActivityError,
  type ActivityCandidate,
  type ActivityScope,
} from './types.ts';

export type ActivityFeed = 'txlist' | 'tokentx';
export const ACTIVITY_PAGE_SIZE = 20;
const integer = (value: unknown): string => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new ActivityError('INVALID');
  return value;
};
export function decodeActivityPage(
  value: unknown,
  feed: ActivityFeed,
  owner: string
): readonly ActivityCandidate[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ActivityError('INVALID');
  const body = value as Record<string, unknown>;
  if (
    body.status === '0' &&
    body.message === 'No transactions found' &&
    Array.isArray(body.result) &&
    body.result.length === 0
  )
    return [];
  if (
    body.status !== '1' ||
    body.message === 'NOTOK' ||
    !Array.isArray(body.result) ||
    body.result.length > ACTIVITY_PAGE_SIZE
  )
    throw new ActivityError('INVALID');
  return Object.freeze(
    body.result.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new ActivityError('INVALID');
      const item = raw as Record<string, unknown>;
      if (
        typeof item.hash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(item.hash) ||
        typeof item.from !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(item.from) ||
        !(
          (typeof item.to === 'string' &&
            /^0x[0-9a-fA-F]{40}$/.test(item.to)) ||
          (feed === 'txlist' && (item.to === '' || item.to === null))
        ) ||
        ![
          item.from.toLowerCase(),
          typeof item.to === 'string' ? item.to.toLowerCase() : '',
        ].includes(owner.toLowerCase())
      )
        throw new ActivityError('INVALID');
      const blockNumber = integer(item.blockNumber);
      let timestamp: number | null = null;
      if (
        typeof item.timeStamp === 'string' &&
        /^(0|[1-9][0-9]{0,11})$/.test(item.timeStamp)
      ) {
        const seconds = Number(item.timeStamp);
        if (
          Number.isSafeInteger(seconds) &&
          seconds > 0 &&
          seconds * 1000 <= Date.now() + 300000
        )
          timestamp = seconds * 1000;
      }
      return Object.freeze({
        hash: item.hash.toLowerCase(),
        blockNumber,
        timestamp,
        tokenHint: feed === 'tokentx',
      });
    })
  );
}
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** Explorer rows discover hashes only. RPC observations supply transaction facts. */
export class ActivityExplorerReader {
  private sequence = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;
  private readonly fetcher: FetchLike;
  constructor(fetcher: FetchLike = (url, init) => fetch(url, init)) {
    this.fetcher = fetcher;
  }
  private async request(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    guard: () => void
  ): Promise<unknown> {
    guard();
    if (signal.aborted) throw new ActivityError('CANCELLED');
    const local = new AbortController();
    const abort = () => local.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 12000);
    const cancelled = new Promise<never>((_, reject) =>
      local.signal.addEventListener(
        'abort',
        () => reject(new ActivityError('CANCELLED')),
        { once: true }
      )
    );
    try {
      const response = await Promise.race([
        this.fetcher(url, {
          ...init,
          signal: local.signal,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        }),
        cancelled,
      ]);
      guard();
      if (!response.ok) throw new ActivityError('UNAVAILABLE');
      const text = await Promise.race([
        boundedResponseText(response, local.signal, 256 * 1024),
        cancelled,
      ]);
      guard();
      return JSON.parse(text);
    } finally {
      local.abort();
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async head(
    scope: ActivityScope,
    signal: AbortSignal,
    guard: () => void
  ): Promise<string> {
    const call = async (method: string, params: unknown[]) => {
      const id = ++this.sequence;
      const result = (await this.request(
        scope.network.rpcUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        },
        signal,
        guard
      )) as Record<string, unknown>;
      if (
        !result ||
        result.jsonrpc !== '2.0' ||
        result.id !== id ||
        Object.hasOwn(result, 'error')
      )
        throw new ActivityError('INVALID');
      return result.result;
    };
    if (parseRpcQuantity(await call('eth_chainId', [])) !== 1n)
      throw new ActivityError('CHANGED');
    return parseRpcQuantity(await call('eth_blockNumber', [])).toString();
  }
  page(
    scope: ActivityScope,
    feed: ActivityFeed,
    page: number,
    endblock: string,
    signal: AbortSignal,
    guard: () => void
  ): Promise<readonly ActivityCandidate[]> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      return Promise.reject(new ActivityError('INVALID'));
    integer(endblock);
    const run = async () => {
      const delay = Math.max(0, this.lastRequest + 550 - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      guard();
      if (signal.aborted) throw new ActivityError('CANCELLED');
      const url = buildAccountHistoryUrl(
        scope.apiUrl,
        scope.address,
        feed,
        page,
        ACTIVITY_PAGE_SIZE
      );
      url.searchParams.set('startblock', '0');
      url.searchParams.set('endblock', endblock);
      this.lastRequest = Date.now();
      return decodeActivityPage(
        await this.request(
          url.toString(),
          { headers: { Accept: 'application/json' } },
          signal,
          guard
        ),
        feed,
        scope.address
      );
    };
    const result = this.tail.then(run, run);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
