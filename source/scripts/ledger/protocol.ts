import type { LedgerHost } from '@sidhujag/sysweb3-keyring/cjs/ledger/host-types';

export const LEDGER_HOST_PORT = 'pali-ledger-host:';
export const LEDGER_HOST_PAGE = 'ledger.html';
export const MAX_LEDGER_MESSAGE_BYTES = 6 * 1024 * 1024;

export type LedgerMethod =
  | 'evm.getAddress'
  | 'evm.signTransaction'
  | 'evm.signPersonalMessage'
  | 'evm.signTypedData'
  | 'utxo.getXpub'
  | 'utxo.getAddress'
  | 'utxo.getAccount'
  | 'utxo.signMessage'
  | 'utxo.signPsbt';

const methods = new Set<LedgerMethod>([
  'evm.getAddress',
  'evm.signTransaction',
  'evm.signPersonalMessage',
  'evm.signTypedData',
  'utxo.getXpub',
  'utxo.getAddress',
  'utxo.getAccount',
  'utxo.signMessage',
  'utxo.signPsbt',
]);

export const ledgerError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

export function snapshotLedgerMessage(value: unknown): any {
  let encoded: string;
  try {
    encoded = JSON.stringify(value, (_key, entry) =>
      typeof entry === 'bigint' ? entry.toString() : entry
    );
  } catch {
    throw ledgerError('LEDGER_INVALID_REQUEST', 'Invalid Ledger request');
  }
  if (
    !encoded ||
    new TextEncoder().encode(encoded).length > MAX_LEDGER_MESSAGE_BYTES
  )
    throw ledgerError('LEDGER_INVALID_REQUEST', 'Ledger request is too large');
  return JSON.parse(encoded);
}

/** Dispatch only semantic device operations; never arbitrary property paths. */
export function invokeLedgerHost(
  host: LedgerHost,
  method: unknown,
  request: unknown,
  portAuthority: Parameters<LedgerHost['utxo']['signPsbt']>[1]
): Promise<unknown> {
  if (typeof method !== 'string' || !methods.has(method as LedgerMethod))
    return Promise.reject(
      ledgerError('LEDGER_INVALID_REQUEST', 'Unknown Ledger operation')
    );
  const approved = snapshotLedgerMessage(request);
  if (method === 'utxo.signPsbt')
    return host.utxo.signPsbt(approved, portAuthority);
  const [group, action] = method.split('.') as ['evm' | 'utxo', string];
  return (host[group][action] as (params: unknown) => Promise<unknown>)(
    approved
  );
}
