import type { GuardianRpcRequest } from './guardianStatus';

const READ_METHODS = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_call',
  'eth_getStorageAt',
]);

/** Reuse settled SDK reads; explicit groups always observe fresh remote chain identity. */
export const guardianStatusProvider = (
  provider: {
    readMany?: (
      requests: GuardianRpcRequest[],
      options?: { signal?: AbortSignal }
    ) => Promise<PromiseSettledResult<unknown>[]>;
  },
  signal?: AbortSignal
) => {
  const readMany = async (requests: GuardianRpcRequest[]) => {
    signal?.throwIfAborted();
    if (!requests.length) return [];
    if (!provider.readMany)
      throw new Error('Live guardian recovery batch transport unavailable');
    if (requests.some(({ method }) => !READ_METHODS.has(method)))
      throw new Error('Unsupported guardian recovery read');
    const results = await provider.readMany(
      requests,
      signal ? { signal } : undefined
    );
    signal?.throwIfAborted();
    if (
      !Array.isArray(results) ||
      results.length !== requests.length ||
      results.some(
        (result) =>
          !result ||
          (result.status !== 'fulfilled' && result.status !== 'rejected')
      )
    )
      throw new Error('Invalid guardian recovery batch response');
    return results;
  };
  return {
    readMany,
    send: async (method: GuardianRpcRequest['method'], params: unknown[]) => {
      const result = (await readMany([{ method, params }]))[0]!;
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    },
  };
};
