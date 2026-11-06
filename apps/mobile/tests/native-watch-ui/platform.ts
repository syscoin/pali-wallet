import { findUtxoCoinByRegistration } from '@sidhujag/sysweb3-network/cjs/coin-utils.js';
import { createUtxoBalanceReader } from '../../src/core/utxoBalanceReader';
import { createUtxoActivityReader } from '../../src/core/utxoActivity';
import { activityFetch } from './utxoActivityFixture';
import { ActivityExplorerReader } from '../../src/activity/explorerReader';
import { ActivityReceiptReader } from '../../src/activity/receiptReader';
import { evmActivityFetch } from './evmActivityFixture';
import { getNetwork } from '../../src/core/networks';
import { parseAccountSelection, type AccountSelection } from '../../src/core/accountDirectory';
import { ACCOUNT_SELECTION_KEY, PUBLIC_ACCOUNTS_KEY, WATCH_UTXO_NETWORKS_KEY, createPublicAccountStorage } from '../../src/core/publicAccountStorage';
import { createWatchAccountCodec } from '../../src/core/watchAccountCodec';
import { parseUtxoPublicIdentifier } from '../../src/core/utxoIdentifier';
import { readAccounts, writeAccounts, readSelection, writeSelection, events, watchBalanceMode } from './state';
import { getUtxoNetwork, type UtxoNetwork, type UtxoNetworkId } from '../../src/core/utxoNetworks';
export const isNativePersistence = true;
const parameters = new URLSearchParams(window.location.search);
const customEnabled = parameters.has('custom-utxo');
let networkStorageFault = parameters.get('custom-utxo-storage-fault');
let failNetworkReadback = false;
const customEndpoint = 'https://watch-ltc.invalid/blockbook';
const badEndpoint = 'https://wrong-ltc.invalid/blockbook';
const ltc = findUtxoCoinByRegistration({ chainId: 2, slip44: 2 })!;
async function customFetch(url: string, options: RequestInit) {
  const base = [customEndpoint, badEndpoint].find((endpoint) => url.startsWith(endpoint + '/api/v2/'));
  if (!customEnabled || !base || options.method !== 'GET') throw Error('Unplanned custom Blockbook fixture');
  events.push(`blockbook:${url}`);
  if (url === base + '/api/v2/') return Response.json({
    blockbook: { coin: ltc.coinName, network: ltc.coinShortcut, decimals: ltc.decimals,
      initialSync: false, inSync: true, inSyncMempool: true, bestHeight: 123 },
    backend: { chain: 'main' },
  });
  if (url === base + '/api/v2/block-index/0') return Response.json({ blockHash: base === badEndpoint ? '0'.repeat(64) : ltc.hashGenesisBlock });
  const address = decodeURIComponent(new URL(url).pathname.split('/xpub/')[1] ?? '');
  if (!address) throw Error('Unplanned account route');
  return Response.json({ address, balance: '123456789', unconfirmedBalance: '0', unconfirmedTxs: 0 });
}
const customBalance = createUtxoBalanceReader({ fetch: customFetch });
function utxoBalance(networkId: UtxoNetworkId, identifier: string) {
  events.push(`balance:${networkId}:${identifier}`);
  if (watchBalanceMode === 'error') throw Error('Synthetic public balance failure');
  return { kind: 'utxo' as const, networkId, chainId: getUtxoNetwork(networkId).chainId, genesisHash: getUtxoNetwork(networkId).genesisHash,
    confirmedUnits: watchBalanceMode === 'zero' ? '0' : '123456789', pendingDeltaUnits: watchBalanceMode === 'zero' ? '0' : networkId === 'syscoin' ? '123' : '-456', unconfirmedTransactions: watchBalanceMode === 'zero' ? 0 : 1, observedHeight: 123 };
}
export const balanceReader = { async readBalance(networkId: Parameters<typeof getNetwork>[0], address: string) {
  events.push(`balance:${networkId}:${address}`);
  return { chainId: getNetwork(networkId).chainId!, units: '2500000000000000000' };
}, async readUtxoBalance(scope: UtxoNetworkId | UtxoNetwork, address: string, signal: AbortSignal, guard?: () => void) {
  return typeof scope === 'string' ? utxoBalance(scope, address) : customBalance.readBalance(scope, address, signal, guard);
}, async readUtxoAccount(scope: UtxoNetworkId | UtxoNetwork, identifier: string, signal: AbortSignal, guard?: () => void) {
  return typeof scope === 'string' ? utxoBalance(scope, parseUtxoPublicIdentifier(identifier, scope).identifier)
    : customBalance.readAccount(scope, identifier, signal, guard);
} };
const codec = createWatchAccountCodec();
const RECORDS_KEY = 'pali-public-watch-records-fixture-v1';
const repository = createPublicAccountStorage({
  async get(key) {
    if (key === WATCH_UTXO_NETWORKS_KEY) {
      if (failNetworkReadback) {
        failNetworkReadback = false;
        throw Error('Synthetic watch network readback failure');
      }
      return localStorage.getItem(WATCH_UTXO_NETWORKS_KEY);
    }
    if (key === ACCOUNT_SELECTION_KEY) return JSON.stringify(readSelection());
    if (key !== PUBLIC_ACCOUNTS_KEY) throw Error('Unexpected fixture storage key');
    // Preserve the real read-failure fixture even after a canonical record write.
    const accounts = readAccounts();
    return localStorage.getItem(RECORDS_KEY) ?? codec.encode(codec.validate(accounts.map((account) => ({ kind: 'address', ...account }))).records);
  },
  async set(key, value) {
    if (key === WATCH_UTXO_NETWORKS_KEY) {
      events.push('watch-network-write');
      const fault = networkStorageFault;
      networkStorageFault = null;
      if (fault === 'write') throw Error('Synthetic watch network write failure');
      localStorage.setItem(key, value);
      failNetworkReadback = fault === 'readback';
      return;
    }
    if (key === ACCOUNT_SELECTION_KEY) { writeSelection(parseAccountSelection(JSON.parse(value))); return; }
    if (key !== PUBLIC_ACCOUNTS_KEY) throw Error('Unexpected fixture storage key');
    if (!customEnabled) writeAccounts(codec.decode(value).accounts);
    localStorage.setItem(RECORDS_KEY, value);
  },
}, customFetch);
export const loadPublicAccounts = repository.loadAccounts;
export const publicAccountRecords = repository.records;
export const watchUtxoNetworkSettings = customEnabled ? repository.utxoNetworkSettings : undefined;
export const loadAccountSelection = repository.loadSelection;
export const saveAccountSelection = (selection: AccountSelection | null) => repository.saveSelection(selection);
export const clearNativeAccountSelection = repository.clearNativeSelection;

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
