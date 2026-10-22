import type { GuardianRpcRequest } from './guardianStatus';

const READ_METHODS = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_call',
  'eth_getStorageAt',
]);

/** Use the keyring's validated mixed-batch transport without its chain-ID cache. */
export const guardianStatusProvider = (provider: {
  _send?: (
    payload: Array<{
      id: number;
      jsonrpc: '2.0';
      method: string;
      params: unknown[];
    }>
  ) => Promise<unknown[]>;
}) => {
  const batch = async (requests: GuardianRpcRequest[]) => {
    if (!requests.length) return [];
    if (!provider._send)
      throw new Error('Live guardian recovery batch transport unavailable');
    if (requests.some(({ method }) => !READ_METHODS.has(method)))
      throw new Error('Unsupported guardian recovery read');
    const payload = requests.map((request, id) => ({
      ...request,
      id,
      jsonrpc: '2.0' as const,
    }));
    const responses = await provider._send(payload);
    // The pinned keyring transport correlates wire IDs and restores request
    // order. Assert that contract here; never pair an unexpected reply by index.
    if (
      !Array.isArray(responses) ||
      responses.length !== payload.length ||
      responses.some((value, index) => {
        const response = value as any;
        return (
          !response ||
          response.jsonrpc !== '2.0' ||
          response.id !== index ||
          !Object.prototype.hasOwnProperty.call(response, 'result') ||
          Object.prototype.hasOwnProperty.call(response, 'error')
        );
      })
    )
      throw new Error('Invalid guardian recovery batch response');
    return responses.map((response: any) => response.result);
  };
  return {
    batch,
    send: async (method: string, params: unknown[]) =>
      (await batch([{ method, params }]))[0],
  };
};
