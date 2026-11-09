import { assertProviderRequestBudget } from '../utils/requestPayloadBudget.ts';

import { UTXO_SUMMARY_OBSERVATION } from './utxoDetailFreshness.ts';
export const DAPP_SYSCOIN_READ_METHODS = Object.freeze([
  'sys_requestAccounts',
  'sys_getAccount',
  'sys_isConnected',
  'sys_getNetwork',
  'sys_getPublicKey',
  'sys_getCurrentAddressPubkey',
  'sys_getBip32Path',
  'sys_getChangeAddress',
  'sys_getTransactions',
  'sys_transaction',
  'sys_isValidSYSAddress',
  'sys_getSentryCapabilities',
] as const);
export type DappSyscoinReadRequest = Readonly<{
  method: (typeof DAPP_SYSCOIN_READ_METHODS)[number];
  params: readonly unknown[];
}>;
export const isDappSyscoinRead = (
  method: string
): method is DappSyscoinReadRequest['method'] =>
  (DAPP_SYSCOIN_READ_METHODS as readonly string[]).includes(method);
export function normalizeDappSyscoinRead(
  method: string,
  input: unknown
): DappSyscoinReadRequest {
  assertProviderRequestBudget({ method, params: input });
  if (
    !isDappSyscoinRead(method) ||
    (input !== undefined && !Array.isArray(input))
  )
    throw new Error('Invalid Syscoin read');
  const params =
    input === undefined ? [] : (JSON.parse(JSON.stringify(input)) as unknown[]);
  if (
    method === 'sys_getCurrentAddressPubkey' ||
    method === 'sys_getBip32Path'
  ) {
    if (
      params.length > 1 ||
      (params[0] !== undefined &&
        (!params[0] ||
          typeof params[0] !== 'object' ||
          Array.isArray(params[0]) ||
          Object.keys(params[0]).some((key) => key !== 'isChangeAddress') ||
          ((params[0] as { isChangeAddress?: unknown }).isChangeAddress !==
            undefined &&
            typeof (params[0] as { isChangeAddress?: unknown })
              .isChangeAddress !== 'boolean')))
    )
      throw new Error('Invalid address selection');
    params[0] = {
      isChangeAddress:
        (params[0] as { isChangeAddress?: boolean } | undefined)
          ?.isChangeAddress ?? false,
    };
  } else if (method === 'sys_transaction') {
    if (
      params.length !== 1 ||
      typeof params[0] !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(params[0])
    )
      throw new Error('Invalid transaction ID');
    params[0] = params[0].toLowerCase();
  } else if (method === 'sys_isValidSYSAddress') {
    if (
      params.length !== 1 ||
      typeof params[0] !== 'string' ||
      params[0].length > 256
    )
      throw new Error('Invalid address');
  } else if (params.length) throw new Error('Expected no parameters');
  return Object.freeze({ method, params: Object.freeze(params) });
}
/** The extension's public transaction projection never discloses local backend provenance. */
export function projectDappSyscoinTransactions(
  transactions: readonly unknown[]
): Record<string, unknown>[] {
  return transactions.map((transaction) => {
    if (
      !transaction ||
      typeof transaction !== 'object' ||
      Array.isArray(transaction) ||
      typeof Object.getOwnPropertyDescriptor(transaction, 'txid')?.value !==
        'string' ||
      !Object.getOwnPropertyDescriptor(transaction, 'txid')?.value
    )
      throw new Error('Invalid public transaction');
    return Object.fromEntries(
      Object.entries(transaction).filter(
        ([key]) =>
          key !== 'localAcknowledgedInputs' && key !== UTXO_SUMMARY_OBSERVATION
      )
    );
  });
}
