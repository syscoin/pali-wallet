import { Interface } from '@ethersproject/abi';

import {
  PALI_INFRASTRUCTURE_BY_ID,
  PALI_MULTICALL3_CANONICAL_ADDRESS,
} from './deployment';
import type { Result } from '@ethersproject/abi';

/**
 * Read-call aggregation for smart-account RPC traffic.
 *
 * Strategy (best transport first):
 *  1. Multicall3 `aggregate3` — one `eth_call`, atomic same-block snapshot,
 *     per-call failure isolation via `allowFailure`.
 *  2. JSON-RPC batch (`provider.sendBatch('eth_call', ...)`) — one HTTP round
 *     trip, no atomicity guarantee.
 *  3. Sequential `eth_call`s — last resort when the RPC rejects batches.
 *
 * All tiers preserve per-call semantics: each entry resolves independently to
 * `{ success, result }` so callers can keep the exact same degradation
 * behavior they had with individual try/catch'd contract calls.
 */

export type AggregateCallRequest = {
  args: ReadonlyArray<unknown>;
  fn: string;
  iface: Interface;
  target: string;
};

export type AggregateCallResult =
  | { result: Result; success: true }
  | { result?: undefined; success: false };

type EthCallProvider = {
  call: (transaction: { data: string; to: string }) => Promise<string>;
  getCode: (address: string) => Promise<string>;
  sendBatch?: (method: string, params: Array<any[]>) => Promise<any[]>;
};

const MULTICALL3_INTERFACE = new Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)',
]);

const MULTICALL3_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

type Multicall3CacheEntry = {
  address: string | null;
  checkedAt: number;
};

const multicall3AddressCache = new Map<number, Multicall3CacheEntry>();

export const clearMulticall3AddressCache = (chainId?: number) => {
  if (chainId === undefined) {
    multicall3AddressCache.clear();
    return;
  }
  multicall3AddressCache.delete(chainId);
};

/**
 * Resolve a deployed Multicall3 address for the chain: the canonical
 * deployment when present, otherwise the Pali CREATE2 infrastructure
 * deployment. Positive results are cached for the session; negative results
 * are re-probed after a short TTL (e.g. after infrastructure deployment).
 */
export const resolveMulticall3Address = async (
  provider: EthCallProvider,
  chainId: number
): Promise<string | null> => {
  const cached = multicall3AddressCache.get(chainId);
  if (cached) {
    const isFreshNegative =
      cached.address === null &&
      Date.now() - cached.checkedAt < MULTICALL3_NEGATIVE_CACHE_TTL_MS;
    if (cached.address !== null || isFreshNegative) {
      return cached.address;
    }
  }

  const candidates = [
    PALI_MULTICALL3_CANONICAL_ADDRESS,
    PALI_INFRASTRUCTURE_BY_ID.multicall3.address,
  ];
  for (const candidate of candidates) {
    try {
      const code = await provider.getCode(candidate);
      if (code && code !== '0x') {
        multicall3AddressCache.set(chainId, {
          address: candidate,
          checkedAt: Date.now(),
        });
        return candidate;
      }
    } catch {
      // Probe failure is treated the same as "not deployed" for this tier;
      // aggregation falls back to JSON-RPC batch / sequential calls.
    }
  }

  multicall3AddressCache.set(chainId, { address: null, checkedAt: Date.now() });
  return null;
};

const encodeCallData = (call: AggregateCallRequest): string =>
  call.iface.encodeFunctionData(call.fn, call.args as unknown[]);

const decodeCallResult = (
  call: AggregateCallRequest,
  returnData: string | undefined
): AggregateCallResult => {
  if (!returnData || returnData === '0x') {
    // Calls to addresses without code (or empty returns where data is
    // expected) decode as failures, mirroring individual Contract calls.
    return { success: false };
  }
  try {
    return {
      result: call.iface.decodeFunctionResult(call.fn, returnData),
      success: true,
    };
  } catch {
    return { success: false };
  }
};

const aggregateViaMulticall3 = async (
  provider: EthCallProvider,
  multicallAddress: string,
  calls: AggregateCallRequest[]
): Promise<AggregateCallResult[]> => {
  const callData = MULTICALL3_INTERFACE.encodeFunctionData('aggregate3', [
    calls.map((call) => ({
      allowFailure: true,
      callData: encodeCallData(call),
      target: call.target,
    })),
  ]);
  const rawResult = await provider.call({
    data: callData,
    to: multicallAddress,
  });
  const [results] = MULTICALL3_INTERFACE.decodeFunctionResult(
    'aggregate3',
    rawResult
  ) as unknown as [Array<{ returnData: string; success: boolean }>];

  return calls.map((call, index) => {
    const entry = results[index];
    if (!entry?.success) {
      return { success: false };
    }
    return decodeCallResult(call, entry.returnData);
  });
};

const aggregateViaJsonRpcBatch = async (
  provider: EthCallProvider,
  calls: AggregateCallRequest[]
): Promise<AggregateCallResult[]> => {
  if (typeof provider.sendBatch !== 'function') {
    throw new Error('Provider does not support JSON-RPC batching');
  }
  const batchParams = calls.map((call) => [
    { data: encodeCallData(call), to: call.target },
    'latest',
  ]);
  const responses = await provider.sendBatch('eth_call', batchParams);
  return calls.map((call, index) => decodeCallResult(call, responses[index]));
};

const aggregateSequentially = async (
  provider: EthCallProvider,
  calls: AggregateCallRequest[]
): Promise<AggregateCallResult[]> => {
  const results: AggregateCallResult[] = [];
  for (const call of calls) {
    try {
      const returnData = await provider.call({
        data: encodeCallData(call),
        to: call.target,
      });
      results.push(decodeCallResult(call, returnData));
    } catch {
      results.push({ success: false });
    }
  }
  return results;
};

export const aggregateContractCalls = async (
  provider: EthCallProvider,
  chainId: number,
  calls: AggregateCallRequest[]
): Promise<AggregateCallResult[]> => {
  if (calls.length === 0) {
    return [];
  }

  const multicallAddress = await resolveMulticall3Address(provider, chainId);
  if (multicallAddress) {
    try {
      return await aggregateViaMulticall3(provider, multicallAddress, calls);
    } catch (error) {
      console.warn(
        '[smartAccount/aggregate] Multicall3 aggregation failed, falling back to JSON-RPC batch:',
        error
      );
    }
  }

  try {
    return await aggregateViaJsonRpcBatch(provider, calls);
  } catch (error) {
    console.warn(
      '[smartAccount/aggregate] JSON-RPC batch aggregation failed, falling back to sequential calls:',
      error
    );
  }

  return aggregateSequentially(provider, calls);
};
