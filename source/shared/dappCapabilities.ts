import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { errorCodes, errorValues } from '../helpers/errors/errorConstants.ts';
import { assertJsonWorkBudget } from '../utils/requestPayloadBudget.ts';

export type DappCapabilitiesRequest = Readonly<{
  address?: string;
  chains?: readonly string[];
}>;

export type DappCapabilitiesScope = Readonly<{
  accountAddress: string | undefined;
  chain: Readonly<{
    atomicSupported: boolean;
    batchSupported: boolean;
    chainId: number;
  }> | null;
}>;

export type DappCapabilities = Readonly<
  Record<
    string,
    Readonly<{ atomic?: Readonly<{ status: 'supported' | 'unsupported' }> }>
  >
>;

const invalid = (): never => {
  throw new EthereumRpcErrorHandler(
    errorCodes.rpc.invalidParams,
    'Invalid capability query params'
  );
};

/** Snapshot the capability query before reading account or network authority. */
export function normalizeDappCapabilitiesRequest(
  params: unknown
): DappCapabilitiesRequest {
  try {
    assertJsonWorkBudget(params);
  } catch {
    return invalid();
  }
  const input = params === undefined ? [] : params;
  if (!Array.isArray(input) || input.length > 2) return invalid();
  const address: unknown = input[0];
  const chains: unknown = input[1];
  let requestedAddress: string | undefined;
  if (address !== undefined) {
    if (typeof address !== 'string' || !/^0x[\da-f]{40}$/i.test(address))
      return invalid();
    requestedAddress = address.toLowerCase();
  }
  let requestedChains: string[] | undefined;
  if (chains !== undefined) {
    if (!Array.isArray(chains)) return invalid();
    requestedChains = Array.from(chains, (chain: unknown) => {
      if (typeof chain !== 'string' || !/^0x[\da-f]+$/i.test(chain))
        return invalid();
      return `0x${BigInt(chain).toString(16)}`;
    });
  }
  return Object.freeze({
    ...(requestedAddress === undefined ? {} : { address: requestedAddress }),
    ...(requestedChains === undefined
      ? {}
      : { chains: Object.freeze(requestedChains) }),
  });
}

/** Hosts supply only their currently authorized chain and actual batch support. */
export function projectDappCapabilities(
  request: DappCapabilitiesRequest,
  scope: DappCapabilitiesScope
): DappCapabilities {
  if (
    !scope.accountAddress ||
    (request.address !== undefined &&
      request.address.toLowerCase() !== scope.accountAddress.toLowerCase())
  )
    throw new EthereumRpcErrorHandler(
      errorCodes.provider.unauthorized,
      errorValues['4100'].message
    );
  if (scope.chain === null) return Object.freeze({});
  const chainId = `0x${scope.chain.chainId.toString(16)}`;
  if (request.chains !== undefined && !request.chains.includes(chainId))
    return Object.freeze({});
  const capabilities = scope.chain.batchSupported
    ? Object.freeze({
        atomic: Object.freeze({
          status: scope.chain.atomicSupported
            ? ('supported' as const)
            : ('unsupported' as const),
        }),
      })
    : Object.freeze({});
  return Object.freeze({ [chainId]: capabilities });
}
