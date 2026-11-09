import { assertProviderRequestBudget } from '../utils/requestPayloadBudget.ts';
export type DappChainScope = Readonly<
  | { chainId: number; kind: 'ethereum' }
  | { chainId: number; genesisHash: string; kind: 'syscoin'; slip44: number }
>;
/** CAIP-2 abbreviates BIP122 genesis; hosts must retain the full pinned scope as authority. */
export function dappCaipChain(scope: DappChainScope): string {
  if (
    !Number.isSafeInteger(scope.chainId) ||
    scope.chainId < (scope.kind === 'ethereum' ? 1 : 0)
  )
    throw new Error('Invalid chain scope');
  if (scope.kind === 'ethereum') return `eip155:${scope.chainId}`;
  if (
    !Number.isSafeInteger(scope.slip44) ||
    scope.slip44 < 0 ||
    !/^[0-9a-f]{64}$/.test(scope.genesisHash)
  )
    throw new Error('Invalid UTXO chain scope');
  return `bip122:${scope.genesisHash.slice(0, 32)}`;
}
export const dappNamespace = (scope: DappChainScope) =>
  scope.kind === 'ethereum' ? 'eip155' : 'bip122';

export const DAPP_MODE_METHODS = Object.freeze([
  'sys_switchChain',
  'eth_changeUTXOEVM',
  'sys_changeUTXOEVM',
] as const);
export type DappModeRequest = Readonly<{
  chainId: number;
  kind: 'ethereum' | 'syscoin';
  method: (typeof DAPP_MODE_METHODS)[number];
}>;
export const requiresDappModeSwitch = (
  request: DappModeRequest,
  current: 'ethereum' | 'syscoin'
) => request.method === 'sys_switchChain' || request.kind !== current;
export function normalizeDappModeRequest(
  method: string,
  params: unknown
): DappModeRequest {
  assertProviderRequestBudget({ method, params });
  if (
    !(DAPP_MODE_METHODS as readonly string[]).includes(method) ||
    !Array.isArray(params) ||
    params.length !== 1 ||
    !params[0] ||
    typeof params[0] !== 'object' ||
    Array.isArray(params[0])
  )
    throw new Error('Invalid network switch');
  const raw = (params[0] as { chainId?: unknown }).chainId;
  if (
    !(
      typeof raw === 'number' ||
      (typeof raw === 'string' &&
        /^(?:\d+|0x[\da-f]+)$/i.test(raw) &&
        raw.length <= 32)
    )
  )
    throw new Error('chainId is required');
  const chainId = Number(raw),
    kind = method === 'eth_changeUTXOEVM' ? 'ethereum' : 'syscoin';
  if (!Number.isSafeInteger(chainId) || chainId < (kind === 'ethereum' ? 1 : 0))
    throw new Error('Invalid chainId');
  return Object.freeze({
    method: method as DappModeRequest['method'],
    kind,
    chainId,
  });
}
