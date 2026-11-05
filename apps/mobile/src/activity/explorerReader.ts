import {
  buildAccountHistoryUrl,
  createRoutescanFetch,
} from '../../../../source/shared/evmExplorer.ts';
import {
  belongsToEvmHistoryAccount,
  mapEvmExplorerTokenTransfer,
  mapEvmExplorerTransaction,
} from '../../../../source/shared/evmHistory.ts';
import { boundedResponseText } from '../platformRpc.ts';
import {
  ActivityError,
  type DiscoveredActivityCandidate,
  type EvmActivityReadScope,
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
  owner: string,
  chainId: number
): readonly DiscoveredActivityCandidate[] {
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
        )
      )
        throw new ActivityError('INVALID');
      const transaction =
        feed === 'tokentx'
          ? mapEvmExplorerTokenTransfer(item, chainId)
          : mapEvmExplorerTransaction(item, chainId);
      if (!belongsToEvmHistoryAccount(transaction, owner))
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
        hash: transaction.hash.toLowerCase(),
        blockNumber,
        timestamp,
        tokenHint: feed === 'tokentx',
        ...(feed === 'tokentx' ? { tokenEvent: Object.freeze({ ...item }) } : {}),
        indexed: Object.freeze({
          ...transaction,
          ...(transaction.tokenTransfer
            ? { tokenTransfer: Object.freeze({ ...transaction.tokenTransfer }) }
            : {}),
        }),
      });
    })
  );
}
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
/** The selected explorer supplies the same mapped display facts used by the extension. */
export class ActivityExplorerReader {
  private readonly fetcher: FetchLike;
  constructor(fetcher: FetchLike = (url, init) => fetch(url, init)) {
    const routescan = createRoutescanFetch(fetcher);
    this.fetcher = (url, init) =>
      new URL(url).origin === 'https://api.routescan.io'
        ? routescan(url, init)
        : fetcher(url, init);
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
  page(
    scope: EvmActivityReadScope,
    feed: ActivityFeed,
    page: number,
    signal: AbortSignal,
    guard: () => void
  ): Promise<readonly DiscoveredActivityCandidate[]> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
      return Promise.reject(new ActivityError('INVALID'));
    const run = async () => {
      guard();
      if (signal.aborted) throw new ActivityError('CANCELLED');
      const url = buildAccountHistoryUrl(
        scope.apiUrl,
        scope.address,
        feed,
        page,
        ACTIVITY_PAGE_SIZE
      );
      return decodeActivityPage(
        await this.request(
          url.toString(),
          { headers: { Accept: 'application/json' } },
          signal,
          guard
        ),
        feed,
        scope.address,
        Number(scope.network.chainId)
      );
    };
    return run();
  }
}

export type { DiscoveredActivityCandidate } from './types.ts';
