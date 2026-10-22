/** Bypass the keyring provider's cached eth_chainId only for this observation. */
export const guardianStatusProvider = (provider: {
  send: (method: string, params: unknown[]) => Promise<unknown>;
  sendBatch?: (method: string, params: unknown[][]) => Promise<unknown[]>;
}) => ({
  send: async (method: string, params: unknown[]) => {
    if (method !== 'eth_chainId') return provider.send(method, params);
    if (!provider.sendBatch)
      throw new Error('Live guardian recovery chain identity unavailable');
    const result = await provider.sendBatch(method, [params]);
    if (!Array.isArray(result) || result.length !== 1)
      throw new Error('Invalid guardian recovery chain identity response');
    return result[0];
  },
});
