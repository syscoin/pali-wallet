import { createUtxoActivityReader } from '../../src/core/utxoActivity';
import { activityFetch } from './utxoActivityFixture';
import { ActivityExplorerReader } from '../../src/activity/explorerReader';
import { ActivityReceiptReader } from '../../src/activity/receiptReader';
import { evmActivityFetch } from './evmActivityFixture';
import { getNetwork } from '../../src/core/networks';
import { parseAccountSelection, type AccountSelection } from '../../src/core/accountDirectory';
import { ACCOUNT_SELECTION_KEY, PUBLIC_ACCOUNTS_KEY, createPublicAccountStorage } from '../../src/core/publicAccountStorage';
import { createWatchAccountCodec } from '../../src/core/watchAccountCodec';
import { parseUtxoPublicIdentifier } from '../../src/core/utxoIdentifier';
import { readAccounts, writeAccounts, readSelection, writeSelection, events, watchBalanceMode } from './state';
import { getUtxoNetwork, type UtxoNetworkId } from '../../src/core/utxoNetworks';
export const isNativePersistence = true;
function utxoBalance(networkId: UtxoNetworkId, identifier: string) {
  events.push(`balance:${networkId}:${identifier}`);
  if (watchBalanceMode === 'error') throw Error('Synthetic public balance failure');
  return { kind: 'utxo' as const, networkId, chainId: getUtxoNetwork(networkId).chainId, genesisHash: getUtxoNetwork(networkId).genesisHash,
    confirmedUnits: watchBalanceMode === 'zero' ? '0' : '123456789', pendingDeltaUnits: watchBalanceMode === 'zero' ? '0' : networkId === 'syscoin' ? '123' : '-456', unconfirmedTransactions: watchBalanceMode === 'zero' ? 0 : 1, observedHeight: 123 };
}
export const balanceReader = { async readBalance(networkId: Parameters<typeof getNetwork>[0], address: string) {
  events.push(`balance:${networkId}:${address}`);
  return { chainId: getNetwork(networkId).chainId!, units: '2500000000000000000' };
}, async readUtxoBalance(networkId: UtxoNetworkId, address: string) {
  return utxoBalance(networkId, address);
}, async readUtxoAccount(networkId: UtxoNetworkId, identifier: string) {
  return utxoBalance(networkId, parseUtxoPublicIdentifier(identifier, networkId).identifier);
} };
const codec = createWatchAccountCodec();
const RECORDS_KEY = 'pali-public-watch-records-fixture-v1';
const repository = createPublicAccountStorage({
  async get(key) {
    if (key === ACCOUNT_SELECTION_KEY) return JSON.stringify(readSelection());
    if (key !== PUBLIC_ACCOUNTS_KEY) throw Error('Unexpected fixture storage key');
    // Preserve the real read-failure fixture even after a canonical record write.
    const accounts = readAccounts();
    return localStorage.getItem(RECORDS_KEY) ?? codec.encode(codec.validate(accounts.map((account) => ({ kind: 'address', ...account }))).records);
  },
  async set(key, value) {
    if (key === ACCOUNT_SELECTION_KEY) { writeSelection(parseAccountSelection(JSON.parse(value))!); return; }
    if (key !== PUBLIC_ACCOUNTS_KEY) throw Error('Unexpected fixture storage key');
    const decoded = codec.decode(value);
    writeAccounts(decoded.accounts);
    localStorage.setItem(RECORDS_KEY, value);
  },
});
export const loadPublicAccounts = repository.loadAccounts;
export const publicAccountRecords = repository.records;
export const loadAccountSelection = repository.loadSelection;
export const saveAccountSelection = (selection: AccountSelection | null) => repository.saveSelection(selection);

export const activityReader = createUtxoActivityReader({ fetch: async (url, init) => { const response = await activityFetch(url, init); if (!response) throw new Error('Unplanned fixture URL'); return response; } });
const evmFetch = async (url: string, init: RequestInit) => {
  const response = await evmActivityFetch(url, init);
  if (!response) throw new Error('Unplanned EVM activity fixture URL');
  return response;
};
export const evmActivityReaders = Object.freeze({
  explorer: new ActivityExplorerReader(evmFetch),
  receipts: new ActivityReceiptReader({ fetch: evmFetch }),
});
