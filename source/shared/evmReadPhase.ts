import { readEvmOwnData } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';

import { BigNumber } from '../utils/ethersV6Compat.ts';
import { assertJsonWorkBudget } from '../utils/requestPayloadBudget.ts';

import { evmCallRequest } from './evmEstimateRequest.ts';
import { assertSynchronousEvmFeeGuard } from './evmFeeGuard.ts';

const READ_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getBalance',
  'eth_getCode',
  'eth_getTransactionCount',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
]);
export const EVM_READ_PHASE_TIMEOUT_MS = 10000;
const MAX_PHASE_READS = 200;
const MAX_PHASE_BYTES = 256 * 1024;

type ReadRequest = Readonly<{ method: string; params: readonly unknown[] }>;
type ReadProvider = {
  readMany?: (
    requests: readonly ReadRequest[],
    options?: { signal: AbortSignal }
  ) => Promise<PromiseSettledResult<unknown>[]>;
  send(method: string, params: unknown[]): Promise<unknown>;
  sendFresh?: (method: string, params: unknown[]) => Promise<unknown>;
  signal?: AbortSignal;
  verifyConfiguredChainId(fresh?: boolean): Promise<void>;
  withReadPhase?: <T>(work: (provider: any) => Promise<T>) => Promise<T>;
};

/** Verification must observe the endpoint after the preceding work completes. */
export function readFreshEvmState(
  provider: {
    send(rpcMethod: string, rpcParams: unknown[]): Promise<any>;
    sendFresh?: (rpcMethod: string, rpcParams: unknown[]) => Promise<any>;
  },
  method: string,
  params: unknown[]
): Promise<any> {
  return provider.sendFresh
    ? provider.sendFresh(method, params)
    : provider.send(method, params);
}

/** One bounded host-owned observation, retired before signing or storage. */
export async function withEvmReadPhase<T>(
  provider: ReadProvider,
  assertCurrent: () => void,
  work: (phase: any) => Promise<T>
): Promise<T> {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort(provider.signal?.reason);
  provider.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => lifetime.abort(new Error('EVM read phase timed out')),
    EVM_READ_PHASE_TIMEOUT_MS
  );
  let open = true;
  const active = () => {
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (!open) throw new Error('EVM read phase ended');
    if (provider.signal?.aborted) throw provider.signal.reason;
    if (lifetime.signal.aborted) throw lifetime.signal.reason;
  };
  const bounded = <Value>(promise: Promise<Value>): Promise<Value> =>
    new Promise((resolve, reject) => {
      const cancel = () => reject(lifetime.signal.reason);
      lifetime.signal.addEventListener('abort', cancel, { once: true });
      if (lifetime.signal.aborted) cancel();
      promise
        .then(resolve, reject)
        .finally(() => lifetime.signal.removeEventListener('abort', cancel));
    });
  const execute = async (source: any, ownsChainChecks: boolean): Promise<T> => {
    active();
    if (ownsChainChecks) {
      await bounded(source.verifyConfiguredChainId(true));
      active();
    }
    const pending = new Map<string, Promise<unknown>>();
    const helpers = new Map<string, Promise<unknown>>();
    let requestBytes = 0;
    let requestCount = 0;
    let queue: Array<{
      fresh: boolean;
      reject(error: unknown): void;
      request: ReadRequest;
      resolve(value: unknown): void;
    }> = [];
    const flush = async () => {
      const batch = queue;
      queue = [];
      try {
        active();
        const results = await bounded(
          source.readMany &&
            !batch.some((item) => item.fresh && source.sendFresh)
            ? source.readMany(
                batch.map(({ request }) => request),
                { signal: lifetime.signal }
              )
            : Promise.allSettled(
                batch.map(({ request, fresh }) =>
                  fresh
                    ? readFreshEvmState(source, request.method, [
                        ...request.params,
                      ])
                    : source.send(request.method, [...request.params])
                )
              )
        );
        active();
        if (!Array.isArray(results) || results.length !== batch.length)
          throw new Error('Invalid EVM read phase response');
        results.forEach((result, index) => {
          const request = batch[index];
          if (!request) throw new Error('Invalid EVM read phase response');
          if (result.status === 'fulfilled') request.resolve(result.value);
          else if (result.status === 'rejected') request.reject(result.reason);
          else request.reject(new Error('Invalid EVM read phase response'));
        });
      } catch (error) {
        batch.forEach(({ reject }) => reject(error));
      }
    };
    const send = (
      method: string,
      params: readonly unknown[],
      fresh = false
    ) => {
      active();
      if (!READ_METHODS.has(method) || !Array.isArray(params))
        throw new Error('Unsupported EVM phase read');
      assertJsonWorkBudget(params, MAX_PHASE_BYTES);
      const key = JSON.stringify([method, params]);
      let result = fresh ? undefined : pending.get(key);
      if (!result) {
        requestBytes += key.length * 2;
        requestCount++;
        if (
          requestCount + helpers.size > MAX_PHASE_READS ||
          requestBytes > MAX_PHASE_BYTES
        )
          throw new Error('EVM read phase work limit exceeded');
        const request = JSON.parse(key) as [string, unknown[]];
        result = new Promise((resolve, reject) => {
          queue.push({
            fresh,
            request: { method: request[0], params: request[1] },
            resolve,
            reject,
          });
          if (queue.length === 1) queueMicrotask(() => void flush());
        });
        if (!fresh) pending.set(key, result);
      }
      return bounded(result).then((value) => {
        active();
        // Each consumer owns its response copy, including after in-flight sharing.
        assertJsonWorkBudget(value, 8 * 1024 * 1024, 64, 100000);
        return value === undefined
          ? undefined
          : JSON.parse(JSON.stringify(value));
      });
    };
    const guardedHelper = (name: string, args: unknown[]) => {
      active();
      const method = source[name];
      if (typeof method !== 'function')
        throw new Error(`Unavailable EVM read helper: ${name}`);
      assertJsonWorkBudget(args, MAX_PHASE_BYTES);
      const key = JSON.stringify([name, args]);
      let result = helpers.get(key);
      if (!result) {
        requestBytes += key.length * 2;
        if (
          requestCount + helpers.size >= MAX_PHASE_READS ||
          requestBytes > MAX_PHASE_BYTES
        )
          throw new Error('EVM read phase work limit exceeded');
        result = bounded(
          Promise.resolve().then(() => {
            active();
            return method.apply(source, JSON.parse(JSON.stringify(args)));
          })
        );
        helpers.set(key, result);
      }
      return result.then((value) => {
        active();
        return value;
      });
    };
    const callRequest = (input: Record<string, any>) => {
      assertJsonWorkBudget(input, MAX_PHASE_BYTES);
      const snapshot = JSON.parse(JSON.stringify(input));
      const fields = new Set([
        'from',
        'to',
        'data',
        'value',
        'nonce',
        'accessList',
        'gasPrice',
        'maxFeePerGas',
        'maxPriorityFeePerGas',
        'type',
        'chainId',
        'gasLimit',
      ]);
      if (Object.keys(snapshot).some((field) => !fields.has(field)))
        throw new Error('Unsupported EVM phase call field');
      const request: Record<string, unknown> = evmCallRequest({
        from: snapshot.from,
        to: snapshot.to ?? null,
        data: snapshot.data ?? '0x',
        value: String(snapshot.value ?? 0),
        ...(snapshot.nonce === undefined
          ? {}
          : { nonce: String(snapshot.nonce) }),
        ...(snapshot.accessList === undefined
          ? {}
          : { accessList: snapshot.accessList }),
      });
      for (const field of [
        'gasPrice',
        'maxFeePerGas',
        'maxPriorityFeePerGas',
        'type',
        'chainId',
      ] as const)
        if (snapshot[field] !== undefined)
          request[field] = `0x${BigInt(snapshot[field]).toString(16)}`;
      if (snapshot.gasLimit !== undefined)
        request.gas = `0x${BigInt(snapshot.gasLimit).toString(16)}`;
      return request;
    };
    const scoped: any = Object.freeze({
      signal: lifetime.signal,
      send,
      sendFresh: (method: string, params: readonly unknown[]) =>
        send(method, params, true),
      readMany: async (requests: readonly ReadRequest[]) => {
        active();
        assertJsonWorkBudget(requests, MAX_PHASE_BYTES);
        if (requests.length > MAX_PHASE_READS)
          throw new Error('EVM read phase work limit exceeded');
        const values = await Promise.allSettled(
          requests.map((request) => {
            const snapshot = readEvmOwnData(request, ['method', 'params']);
            return send(
              snapshot.method as string,
              snapshot.params as unknown[]
            );
          })
        );
        active();
        return values;
      },
      sendBatch: async (
        method: string,
        params: readonly (readonly unknown[])[]
      ) => {
        active();
        assertJsonWorkBudget(params, MAX_PHASE_BYTES);
        const results = await scoped.readMany(
          params.map((values) => ({ method, params: values }))
        );
        return results.map((result: PromiseSettledResult<unknown>) => {
          if (result.status === 'rejected') throw result.reason;
          return result.value;
        });
      },
      verifyConfiguredChainId: async () => active(),
      withReadPhase: async (read: (nested: any) => Promise<unknown>) => {
        active();
        const result = await bounded(
          Promise.resolve().then(() => read(scoped))
        );
        active();
        return result;
      },
      getBalance: async (address: string, block: unknown = 'latest') =>
        BigNumber.from(await send('eth_getBalance', [address, block])),
      getCode: (address: string, block: unknown = 'latest') =>
        send('eth_getCode', [address, block]),
      call: (input: Record<string, any>, block: unknown = 'latest') =>
        send('eth_call', [callRequest(input), block]),
      estimateGas: async (input: Record<string, any>) =>
        BigNumber.from(await send('eth_estimateGas', [callRequest(input)])),
      getGasPrice: async () => BigNumber.from(await send('eth_gasPrice', [])),
      getBlockNumber: async () =>
        Number(BigInt((await send('eth_blockNumber', [])) as string)),
      getTransactionCount: async (address: string, block: unknown = 'latest') =>
        Number(
          BigInt(
            (await send('eth_getTransactionCount', [address, block])) as string
          )
        ),
      getNetwork: () => guardedHelper('getNetwork', []),
      getFeeData: () => guardedHelper('getFeeData', []),
      getBlock: (...args: unknown[]) => guardedHelper('getBlock', args),
    });
    const result = await bounded(Promise.resolve().then(() => work(scoped)));
    active();
    if (ownsChainChecks) {
      await bounded(source.verifyConfiguredChainId(true));
      active();
    }
    return result;
  };
  try {
    active();
    return provider.withReadPhase
      ? await bounded(
          provider.withReadPhase((source) => execute(source, false))
        )
      : await execute(provider, true);
  } finally {
    open = false;
    lifetime.abort(new Error('EVM read phase ended'));
    clearTimeout(timer);
    provider.signal?.removeEventListener('abort', abort);
  }
}
