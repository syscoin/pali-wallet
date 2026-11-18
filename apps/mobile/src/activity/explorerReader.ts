import { getPrivacyPoolActivity } from '../../../../source/shared/privacyPoolActivity.ts';
import {
  buildAccountHistoryUrl,
  createRoutescanFetch,
  isRoutescanApiUrl,
} from '../../../../source/shared/evmExplorer.ts';
import {
  belongsToEvmHistoryAccount,
  EVM_TRANSACTION_HISTORY_SOURCE,
  isEmptyEvmHistoryResponse,
  mapEvmExplorerTokenTransfer,
  mapEvmExplorerTransaction,
} from '../../../../source/shared/evmHistory.ts';
import { boundedResponseText } from '../platformRpc.ts';
import {
  ActivityError,
  type DiscoveredActivityCandidate,
  type EvmActivityReadScope,
  type IndexedActivityTransaction,
} from './types.ts';

export type ActivityFeed = 'txlist' | 'tokentx';
export const ACTIVITY_PAGE_SIZE = 20;
const integer = (value: unknown): string => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value))
    throw new ActivityError('INVALID');
  return value;
};
const readActivityTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(value))
    return null;
  const seconds = Number(value);
  return seconds > 0 && seconds * 1000 <= Date.now() + 300000
    ? seconds * 1000
    : null;
};
function readActivityItem(value: unknown, allowCreation: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ActivityError('INVALID');
  const item = value as Record<string, unknown>;
  if (
    typeof item.hash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(item.hash) ||
    typeof item.from !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(item.from) ||
    !(
      (typeof item.to === 'string' && /^0x[0-9a-fA-F]{40}$/.test(item.to)) ||
      (allowCreation && (item.to === '' || item.to === null))
    )
  )
    throw new ActivityError('INVALID');
  return item;
}
export function decodeActivityPage(
  value: unknown,
  feed: ActivityFeed,
  owner: string,
  chainId: number
): readonly DiscoveredActivityCandidate[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ActivityError('INVALID');
  const body = value as Record<string, unknown>;
  if (isEmptyEvmHistoryResponse(body, feed)) return [];
  if (
    body.status !== '1' ||
    body.message === 'NOTOK' ||
    !Array.isArray(body.result) ||
    body.result.length > ACTIVITY_PAGE_SIZE
  )
    throw new ActivityError('INVALID');
  return Object.freeze(
    body.result.map((raw) => {
      const item = readActivityItem(raw, feed === 'txlist');
      const transaction =
        feed === 'tokentx'
          ? mapEvmExplorerTokenTransfer(item, chainId)
          : mapEvmExplorerTransaction(item, chainId);
      if (!belongsToEvmHistoryAccount(transaction, owner))
        throw new ActivityError('INVALID');
      const blockNumber = integer(item.blockNumber);
      const timestamp = readActivityTimestamp(item.timeStamp);
      const privacyActivity = feed === 'txlist'
        ? getPrivacyPoolActivity(chainId, transaction.to, transaction.input)
        : undefined;
      return Object.freeze({
        hash: transaction.hash.toLowerCase(),
        blockNumber,
        timestamp,
        tokenHint: feed === 'tokentx',
        ...(feed === 'tokentx' ? { tokenEvent: Object.freeze({ ...item }) } : {}),
        indexed: Object.freeze({
          ...transaction,
          ...(privacyActivity ? { privacyActivity } : {}),
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
  async pending(
    scope: EvmActivityReadScope,
    signal: AbortSignal,
    guard: () => void
  ): Promise<readonly IndexedActivityTransaction[]> {
    guard();
    const chainId = Number(scope.network.chainId);
    if (!scope.apiUrl || isRoutescanApiUrl(scope.apiUrl, chainId)) return [];
    try {
      const url = buildAccountHistoryUrl(
        scope.apiUrl,
        scope.address,
        'pendingtxlist',
        1,
        ACTIVITY_PAGE_SIZE
      );
      const body = await this.request(
        url.toString(),
        { headers: { Accept: 'application/json' } },
        signal,
        guard
      );
      if (
        !body ||
        typeof body !== 'object' ||
        !('status' in body) ||
        body.status !== '1' ||
        ('message' in body && body.message === 'NOTOK') ||
        !('result' in body) ||
        !Array.isArray(body.result) ||
        body.result.length > ACTIVITY_PAGE_SIZE
      )
        return [];
      return body.result.map((raw) => {
        const item = readActivityItem(raw, true);
        const indexed: IndexedActivityTransaction = mapEvmExplorerTransaction(
          {
            ...item,
            value: integer(item.value),
            blockNumber: undefined,
            blockHash: undefined,
            confirmations: 0,
            txreceipt_status: null,
            isError: null,
          },
          chainId,
          undefined,
          EVM_TRANSACTION_HISTORY_SOURCE.ExplorerPending
        );
        if (!belongsToEvmHistoryAccount(indexed, scope.address))
          throw new ActivityError('INVALID');
        const privacyActivity = getPrivacyPoolActivity(
          chainId, indexed.to, indexed.input
        );
        return Object.freeze({
          ...indexed,
          hash: indexed.hash.toLowerCase(),
          timestamp: (readActivityTimestamp(item.timeStamp) ?? 0) / 1000,
          ...(privacyActivity ? { privacyActivity } : {}),
        });
      });
    } catch {
      guard();
      if (signal.aborted) throw new ActivityError('CANCELLED');
      // Some explorers have no pending index. Confirmed history remains usable.
      return [];
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
