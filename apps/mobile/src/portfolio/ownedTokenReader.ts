import { createRoutescanFetch } from '../../../../source/shared/evmExplorer.ts';
import {
  parseErc20Units,
  type Erc20Metadata,
} from '../../../../source/shared/erc20.ts';
import { fetchOwnedTokenRows } from '../../../../source/utils/tokenDiscovery.ts';
import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
  ResponseSizeLimitError,
} from '../platformRpc.ts';
import type { WalletHttpFetch } from '../platform/httpPolicy.ts';
import { parseErc20Metadata } from './erc20Metadata.ts';

const MAX_PAGE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;
const MAX_ROWS = 1000;
const MAX_SUGGESTIONS = 20;

export type OwnedTokenSuggestions = Readonly<{
  tokens: readonly Pick<Erc20Metadata, 'contractAddress' | 'name' | 'symbol'>[];
  limited: boolean;
}>;

export type OwnedTokenReader = (
  scope: Readonly<{ apiUrl: string; chainId: number; address: string }>,
  saved: ReadonlySet<string>,
  signal: AbortSignal,
  assertCurrent: () => void
) => Promise<OwnedTokenSuggestions>;

/** One operation's indexer observations. Only its contract address can enter review. */
export function createOwnedTokenReader(
  fetcher: WalletHttpFetch
): OwnedTokenReader {
  // A stalled transport cannot hold the shared per-reader Routescan pacing queue.
  const routescan = createRoutescanFetch((url, init) => {
    const signal = init.signal!;
    if (signal.aborted) return Promise.reject(new Error('CANCELLED'));
    return abortable(fetcher(url, init), signal);
  });

  return async ({ apiUrl, address, chainId }, saved, signal, assertCurrent) => {
    const api = new URL(apiUrl);
    if (api.protocol !== 'https:' || api.username || api.password || api.hash)
      throw new Error('Invalid explorer API');
    const current = () => {
      assertCurrent();
      if (signal.aborted) throw new Error('CANCELLED');
    };
    current();
    let bytes = 0;
    const rows = await fetchOwnedTokenRows(apiUrl, address, chainId, false, {
      signal,
      async fetch(url, init, paced) {
        current();
        if (new URL(url).origin !== api.origin)
          throw new Error('Explorer API changed');
        const options: RequestInit = {
          ...init,
          method: 'GET',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        };
        const response = await abortable(
          paced ? routescan(url, options, current) : fetcher(url, options),
          signal
        );
        try {
          current();
          if (response.redirected || (response.url && response.url !== url))
            throw new Error('Explorer API changed');
        } catch (error) {
          cancelResponseBody(response);
          throw error;
        }
        if (!response.ok) cancelResponseBody(response);
        return response;
      },
      async readJson(response) {
        current();
        const text = await boundedResponseText(
          response,
          signal,
          MAX_PAGE_BYTES,
          (size) => {
            bytes += size;
            if (bytes > MAX_TOTAL_BYTES) throw new ResponseSizeLimitError();
          }
        );
        current();
        return JSON.parse(text);
      },
    });
    current();
    if (rows.length > MAX_ROWS) throw new Error('Too many token holdings');
    const seen = new Set(saved);
    const tokens: OwnedTokenSuggestions['tokens'][number][] = [];
    let limited = false;
    for (const row of rows) {
      if (
        !row ||
        (row.type !== undefined && row.type !== 'ERC-20') ||
        row.id !== undefined
      )
        continue;
      try {
        const balance = Number.isSafeInteger(row.balance)
          ? String(row.balance)
          : row.balance;
        if (parseErc20Units(balance) === '0') continue;
        const { contractAddress, name, symbol } = parseErc20Metadata({
          contractAddress: row.contractAddress,
          name: row.name,
          symbol: row.symbol,
          decimals:
            typeof row.decimals === 'string' &&
            /^[0-9]{1,3}$/.test(row.decimals)
              ? Number(row.decimals)
              : row.decimals,
        });
        if (seen.has(contractAddress)) continue;
        if (tokens.length === MAX_SUGGESTIONS) {
          limited = true;
          break;
        }
        seen.add(contractAddress);
        tokens.push(Object.freeze({ contractAddress, name, symbol }));
      } catch {
        // Malformed provider rows are not suggestions.
      }
    }
    return Object.freeze({ tokens: Object.freeze(tokens), limited });
  };
}
