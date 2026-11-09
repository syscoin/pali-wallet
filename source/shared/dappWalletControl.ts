import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import { normalizeNftTokenId } from '../utils/nftTokenId.ts';
import { assertProviderRequestBudget } from '../utils/requestPayloadBudget.ts';

export type DappNetworkMethod =
  | 'wallet_switchEthereumChain'
  | 'wallet_addEthereumChain';
export type DappWalletControlMethod = DappNetworkMethod | 'wallet_watchAsset';
export type DappNetworkRequest = Readonly<{
  blockExplorerUrls: readonly string[];
  chainId: number;
  chainIdHex: string;
  chainName?: string;
  method: DappNetworkMethod;
  nativeCurrency?: Readonly<{
    decimals: number;
    name?: string;
    symbol: string;
  }>;
  rpcUrls: readonly string[];
}>;
export type DappWatchAssetRequest = Readonly<{
  address: string;
  method: 'wallet_watchAsset';
  requestedSymbol?: string;
  tokenId?: string;
  type: 'ERC20' | 'ERC721' | 'ERC1155';
}>;
export type DappWalletControlRequest =
  | DappNetworkRequest
  | DappWatchAssetRequest;
const invalid = (message: string): never => {
  throw new EthereumRpcErrorHandler(-32602, message);
};
export function isDappWalletControlMethod(
  method: string
): method is DappWalletControlMethod {
  return (
    method === 'wallet_switchEthereumChain' ||
    method === 'wallet_addEthereumChain' ||
    method === 'wallet_watchAsset'
  );
}
function one(params: unknown): Record<string, any> {
  const values = Array.isArray(params) ? params : [params];
  if (
    values.length !== 1 ||
    !values[0] ||
    typeof values[0] !== 'object' ||
    Array.isArray(values[0])
  )
    return invalid('Expected one wallet request');
  return values[0];
}
/** The extension's chain-id/RPC admission policy, shared before provider I/O. */
export function assertDappNetworkRequest(
  method: DappNetworkMethod,
  params: unknown
): void {
  const chain = one(params),
    chainId = chain.chainId;
  if (
    typeof chainId !== 'string' ||
    !/^0x[\da-f]+$/i.test(chainId) ||
    !Number.isSafeInteger(Number(chainId)) ||
    Number(chainId) <= 0
  )
    return invalid('Invalid chainId');
  if (
    method === 'wallet_addEthereumChain' &&
    (!Array.isArray(chain.rpcUrls) ||
      !chain.rpcUrls.length ||
      chain.rpcUrls.some((value: unknown) => {
        if (typeof value !== 'string') return true;
        try {
          return !['https:', 'http:'].includes(new URL(value).protocol);
        } catch {
          return true;
        }
      }))
  )
    return invalid('Valid rpcUrls are required');
}
/** Detached public input only. A provider observation, never this metadata, authorizes import. */
export function normalizeDappWalletControl(
  method: DappNetworkMethod,
  params: unknown
): DappNetworkRequest;
export function normalizeDappWalletControl(
  method: 'wallet_watchAsset',
  params: unknown
): DappWatchAssetRequest;
export function normalizeDappWalletControl(
  method: DappWalletControlMethod,
  params: unknown
): DappWalletControlRequest;
export function normalizeDappWalletControl(
  method: DappWalletControlMethod,
  params: unknown
): DappWalletControlRequest {
  assertProviderRequestBudget({ method, params });
  const value = one(params);
  if (method === 'wallet_watchAsset') {
    if (
      !['ERC20', 'ERC721', 'ERC1155'].includes(value.type) ||
      !value.options ||
      typeof value.options !== 'object' ||
      Array.isArray(value.options)
    )
      return invalid('Unsupported asset type');
    const { address, symbol } = value.options;
    if (
      typeof address !== 'string' ||
      !/^0x[\da-f]{40}$/i.test(address) ||
      /^0x0{40}$/i.test(address)
    )
      return invalid('Invalid token address');
    let tokenId: string | undefined;
    if (value.type === 'ERC1155') {
      try {
        tokenId = normalizeNftTokenId(value.options.tokenId);
      } catch {
        return invalid('Invalid token id');
      }
    }
    return Object.freeze({
      method,
      type: value.type,
      address,
      ...(tokenId !== undefined ? { tokenId } : {}),
      ...(typeof symbol === 'string' ? { requestedSymbol: symbol } : {}),
    });
  }
  assertDappNetworkRequest(method, params);
  const chainId = Number(value.chainId);
  if (method === 'wallet_switchEthereumChain')
    return Object.freeze({
      method,
      chainId,
      chainIdHex: `0x${chainId.toString(16)}`,
      rpcUrls: Object.freeze([]),
      blockExplorerUrls: Object.freeze([]),
    });
  const currency = value.nativeCurrency;
  if (
    currency !== undefined &&
    (!currency ||
      typeof currency !== 'object' ||
      typeof currency.symbol !== 'string' ||
      !Number.isSafeInteger(currency.decimals) ||
      currency.decimals < 0 ||
      currency.decimals > 255)
  )
    return invalid('Invalid native currency');
  if (value.chainName !== undefined && typeof value.chainName !== 'string')
    return invalid('Invalid chain name');
  if (
    value.blockExplorerUrls !== undefined &&
    (!Array.isArray(value.blockExplorerUrls) ||
      value.blockExplorerUrls.some((url: unknown) => typeof url !== 'string'))
  )
    return invalid('Invalid explorer URLs');
  return Object.freeze({
    method,
    chainId,
    chainIdHex: `0x${chainId.toString(16)}`,
    rpcUrls: Object.freeze([...(value.rpcUrls ?? [])]),
    blockExplorerUrls: Object.freeze([...(value.blockExplorerUrls ?? [])]),
    ...(value.chainName !== undefined ? { chainName: value.chainName } : {}),
    ...(currency
      ? {
          nativeCurrency: Object.freeze({
            symbol: currency.symbol,
            decimals: currency.decimals,
            ...(typeof currency.name === 'string'
              ? { name: currency.name }
              : {}),
          }),
        }
      : {}),
  });
}
