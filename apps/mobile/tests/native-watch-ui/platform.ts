import { getNetwork } from '../../src/core/networks';
import { parseAccountSelection, type AccountSelection } from '../../src/core/accountDirectory';
import { validatePublicAccounts } from '../../src/core/watchOnlyAuthority';
import type { PublicAccount } from '../../src/core/types';
import { readAccounts, writeAccounts, readSelection, writeSelection, events } from './state';
export const isNativePersistence = true;
export const balanceReader = { async readBalance(networkId: Parameters<typeof getNetwork>[0], address: string) {
  events.push(`balance:${networkId}:${address}`);
  return { chainId: getNetwork(networkId).chainId!, units: '2500000000000000000' };
} };
export async function loadPublicAccounts() { return validatePublicAccounts(readAccounts()); }
export async function savePublicAccounts(accounts: readonly PublicAccount[]) { writeAccounts(validatePublicAccounts(accounts)); }
export async function compareAndSetPublicAccounts(expected: readonly PublicAccount[], accounts: readonly PublicAccount[]) {
  if (JSON.stringify(readAccounts()) !== JSON.stringify(expected)) throw Error('Synthetic stale public snapshot');
  writeAccounts(validatePublicAccounts(accounts));
}
export async function loadAccountSelection() { return parseAccountSelection(readSelection()); }
export async function saveAccountSelection(selection: AccountSelection) { writeSelection(parseAccountSelection(selection)!); }
