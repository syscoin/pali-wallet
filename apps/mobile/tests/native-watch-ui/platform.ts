import { getNetwork } from '../../src/core/networks';
import { parseAccountSelection, type AccountSelection } from '../../src/core/accountDirectory';
import { validatePublicAccounts } from '../../src/core/watchOnlyAuthority';
import type { PublicAccount } from '../../src/core/types';
import { readAccounts, writeAccounts, readSelection, writeSelection, events, watchBalanceMode } from './state';
import { getUtxoNetwork, type UtxoNetworkId } from '../../src/core/utxoNetworks';
export const isNativePersistence = true;
export const balanceReader = { async readBalance(networkId: Parameters<typeof getNetwork>[0], address: string) {
  events.push(`balance:${networkId}:${address}`);
  return { chainId: getNetwork(networkId).chainId!, units: '2500000000000000000' };
}, async readUtxoBalance(networkId: UtxoNetworkId, address: string) {
  events.push(`balance:${networkId}:${address}`);
  if (watchBalanceMode === 'error') throw Error('Synthetic public balance failure');
  return { kind: 'utxo' as const, networkId, chainId: getUtxoNetwork(networkId).chainId, genesisHash: getUtxoNetwork(networkId).genesisHash,
    confirmedUnits: watchBalanceMode === 'zero' ? '0' : '123456789', pendingDeltaUnits: watchBalanceMode === 'zero' ? '0' : networkId === 'syscoin' ? '123' : '-456', unconfirmedTransactions: watchBalanceMode === 'zero' ? 0 : 1, observedHeight: 123 };
} };
export async function loadPublicAccounts() { return validatePublicAccounts(readAccounts()); }
export async function savePublicAccounts(accounts: readonly PublicAccount[]) { writeAccounts(validatePublicAccounts(accounts)); }
export async function compareAndSetPublicAccounts(expected: readonly PublicAccount[], accounts: readonly PublicAccount[]) {
  if (JSON.stringify(readAccounts()) !== JSON.stringify(expected)) throw Error('Synthetic stale public snapshot');
  writeAccounts(validatePublicAccounts(accounts));
}
export async function loadAccountSelection() { return parseAccountSelection(readSelection()); }
export async function saveAccountSelection(selection: AccountSelection) { writeSelection(parseAccountSelection(selection)!); }
