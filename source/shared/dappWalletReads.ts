import { EthereumRpcErrorHandler } from '../helpers/errors/errorClassesHandlers.ts';
import {
  assertProviderRequestBudget,
  assertJsonWorkBudget,
} from '../utils/requestPayloadBudget.ts';

import { formatTokenUnits } from './erc20.ts';
import type { ITokenEthProps, ITokenSysProps } from '../types/tokens.ts';

export const DAPP_WALLET_READ_METHODS = Object.freeze([
  'wallet_getBalance',
  'wallet_getTokens',
  'wallet_estimateFee',
] as const);
export type DappWalletReadMethod = (typeof DAPP_WALLET_READ_METHODS)[number];
export const isDappWalletRead = (
  method: string
): method is DappWalletReadMethod =>
  (DAPP_WALLET_READ_METHODS as readonly string[]).includes(method);
export function normalizeDappWalletRead(
  method: string,
  params: unknown
): DappWalletReadMethod {
  assertProviderRequestBudget({ method, params });
  if (
    !isDappWalletRead(method) ||
    (params !== undefined && (!Array.isArray(params) || params.length !== 0))
  )
    throw new EthereumRpcErrorHandler(
      -32602,
      'Expected no wallet read parameters'
    );
  return method;
}

/** Existing public API response; never a transaction/funding amount. */
export function projectWalletBalance(value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  )
    return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    return value;
  throw new EthereumRpcErrorHandler(-32603, 'Balance unavailable');
}
export function projectWalletBalanceUnits(
  units: string,
  decimals: number
): string {
  if (
    !/^(?:0|[1-9][0-9]{0,77})$/.test(units) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    throw new EthereumRpcErrorHandler(-32603, 'Balance unavailable');
  return formatTokenUnits(units, decimals);
}
/** Match the existing extension UTXO observation: confirmed plus signed pending, clamped at zero. */
export function projectWalletAvailableBalanceUnits(
  confirmed: string,
  pending: string,
  decimals: number
): string {
  if (
    !/^(?:0|[1-9][0-9]*)$/.test(confirmed) ||
    !/^(?:0|-?[1-9][0-9]*)$/.test(pending)
  )
    throw new EthereumRpcErrorHandler(-32603, 'Balance unavailable');
  const total = BigInt(confirmed) + BigInt(pending);
  if (total <= BigInt(0)) return '0';
  const value = projectWalletBalanceUnits(total.toString(), decimals);
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}
/** Optional token.balance is a public numeric field; rawBalance remains exact. */
export function projectWalletTokenBalanceUnits(
  units: string,
  decimals: number
): number {
  return projectWalletBalance(
    Number(projectWalletBalanceUnits(units, decimals))
  ) as number;
}

export type DappWalletTokens = Readonly<{
  ethereum: readonly ITokenEthProps[];
  syscoin: readonly ITokenSysProps[];
}>;
export function walletTokenChainId(chainId: string): number {
  const value = Number(chainId);
  if (!/^[1-9][0-9]*$/.test(chainId) || !Number.isSafeInteger(value))
    throw new EthereumRpcErrorHandler(
      -32603,
      'Chain ID cannot be represented by the public token response'
    );
  return value;
}
const ETH_TOKEN_FIELDS = [
  'balance',
  'chainId',
  'contractAddress',
  'decimals',
  'id',
  'isNft',
  'logo',
  'name',
  'rawBalance',
  'tokenId',
  'tokenStandard',
  'tokenSymbol',
] as const;
const SYS_TOKEN_FIELDS = [
  'assetGuid',
  'assetType',
  'balance',
  'chainId',
  'contract',
  'decimals',
  'description',
  'image',
  'maxSupply',
  'metaData',
  'name',
  'originDecimals',
  'path',
  'symbol',
  'tokenId',
  'totalReceived',
  'totalSent',
  'totalSupply',
  'transfers',
  'type',
] as const;
/** The extension's public container; native additionally applies its negotiated chain ceiling. */
export type DappWalletTokenScope = Readonly<
  | { kind: 'all' }
  | { chainId: number; family: 'ethereum' | 'syscoin'; kind: 'chain' }
>;
export function projectWalletTokens(
  value: DappWalletTokens | readonly [],
  scope: DappWalletTokenScope
): DappWalletTokens | readonly [] {
  if (
    scope.kind === 'chain' &&
    (!Number.isSafeInteger(scope.chainId) ||
      scope.chainId < 0 ||
      (scope.family === 'ethereum' && scope.chainId === 0))
  )
    throw new EthereumRpcErrorHandler(-32603, 'Invalid token response chain');
  assertJsonWorkBudget(value);
  if (Array.isArray(value)) {
    if (value.length)
      throw new EthereumRpcErrorHandler(
        -32603,
        'Token observations unavailable'
      );
    return Object.freeze([] as []);
  }
  const assets = value as DappWalletTokens;
  if (!Array.isArray(assets.ethereum) || !Array.isArray(assets.syscoin))
    throw new EthereumRpcErrorHandler(-32603, 'Token observations unavailable');
  const copy = <T extends { chainId?: number }>(
    rows: readonly T[],
    family: 'ethereum' | 'syscoin'
  ): readonly T[] =>
    Object.freeze(
      rows
        .filter(
          (row) =>
            scope.kind === 'all' ||
            (scope.family === family && row.chainId === scope.chainId)
        )
        .map((row) =>
          Object.freeze(
            Object.fromEntries(
              (family === 'ethereum'
                ? ETH_TOKEN_FIELDS
                : SYS_TOKEN_FIELDS
              ).flatMap((key) => {
                const field = Object.getOwnPropertyDescriptor(row, key);
                if (!field || field.value === undefined) return [];
                if (
                  !('value' in field) ||
                  (field.value !== null &&
                    !['string', 'number', 'boolean'].includes(
                      typeof field.value
                    ))
                )
                  throw new EthereumRpcErrorHandler(
                    -32603,
                    'Token observations unavailable'
                  );
                return [[key, field.value]];
              })
            ) as T
          )
        )
    );
  return Object.freeze({
    ethereum: copy(assets.ethereum, 'ethereum'),
    syscoin: copy(assets.syscoin, 'syscoin'),
  });
}

/** Both hosts report unavailable estimates; neither invents a fee for a failed read. */
export async function readWalletFee(
  read: () => Promise<number | string>,
  assertCurrent: () => void
): Promise<number | string> {
  assertCurrent();
  try {
    const result = await read();
    assertCurrent();
    if (
      typeof result === 'number'
        ? !Number.isFinite(result) || result <= 0
        : !/^[1-9][0-9]*$/.test(result)
    )
      throw new Error('Invalid fee estimate');
    return result;
  } catch (cause) {
    assertCurrent();
    const code =
      cause && typeof cause === 'object' && 'code' in cause
        ? cause.code
        : undefined;
    const message = cause instanceof Error ? cause.message : '';
    if (
      code === 'CANCELLED' ||
      code === 'CONTEXT_CHANGED' ||
      (cause instanceof Error && cause.name === 'AbortError') ||
      /^(?:CANCELLED|CONTEXT_CHANGED|UTXO_SIGNING_CONTEXT_CHANGED)$/.test(
        message
      )
    )
      throw cause;
    throw new EthereumRpcErrorHandler(-32603, 'Fee estimate unavailable');
  }
}
