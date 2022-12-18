// resolve response.result or response, reject errors
export const getRpcPromiseCallback =
  (
    resolve: (value?: any) => void,
    reject: (error?: Error) => void,
    unwrapResult = true
  ) =>
  (error: Error, response: any): void => {
    if (error || response.error) {
      reject(error || response.error);
    } else {
      !unwrapResult || Array.isArray(response)
        ? resolve(response)
        : resolve(response.result);
    }
  };

/**
 * Checks whether the given chain ID is valid, meaning if it is non-empty,
 * '0x'-prefixed string.
 *
 * @param chainId - The chain ID to validate.
 * @returns Whether the given chain ID is valid.
 */
export const isValidChainId = (chainId: unknown): chainId is string =>
  Boolean(chainId) && typeof chainId === 'string' && chainId.startsWith('0x');

/**
 * Checks whether the given network version is valid, meaning if it is non-empty
 * string.
 *
 * @param networkVersion - The network version to validate.
 * @returns Whether the given network version is valid.
 */
export const isValidNetworkVersion = (
  networkVersion: unknown
): networkVersion is number =>
  Boolean(networkVersion) && typeof networkVersion === 'number';

export const NOOP = () => undefined;
export const EMITTED_NOTIFICATIONS = Object.freeze([
  'eth_subscription', // per eth-json-rpc-filters/subscriptionManager
]);
