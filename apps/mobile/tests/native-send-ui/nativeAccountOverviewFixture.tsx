import React, { useSyncExternalStore } from 'react';
import { AccountPortfolioController } from '../../src/portfolio/accountPortfolio';
import { createPortfolioFilter } from '../../src/portfolio/portfolioFilter';
import { NativeAccountOverview } from '../../src/screens/NativeAccountOverview';
import { RealAppShell } from '../../src/screens/RealAppShell';
import { useRealShell } from '../../src/screens/useRealShell';
import { getNativeNetwork } from '../../src/custody/networkContext';
import type { CustodySnapshot } from '../../src/custody/types';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';

const networks = ['ethereum', 'base', 'syscoin-nevm-testnet'].map(id => getNativeNetwork(id));
const accounts = Array.from({ length: 15 }, (_, index) => ({ id: `hd:60:${index}`, type: 'HDAccount' as const, index, slip44: 60,
  address: `0x${(index + 1).toString(16).padStart(40, '0')}`, label: `Account ${index + 1}` }));
let selected = 0, backups = 0;
const unbacked = new URLSearchParams(window.location.search).has('unbacked');
let state: CustodySnapshot = { phase: unbacked ? 'backup-required' : 'ready', revision: 1, presence: 'existing', backup: unbacked ? 'unconfirmed' : 'confirmed', account: { address: accounts[0]!.address, network: 'ethereum' }, error: null };
let catalogue: NativeWalletCatalogueSnapshot = { revision: 1, active: { accountId: accounts[0]!.id, networkId: 'ethereum' }, networks, utxoNetworks: [], accounts };
const listeners = new Set<(state: CustodySnapshot) => void>();
const source = { getSnapshot: () => state, getCatalogue: () => catalogue, subscribe: (listener: (state: CustodySnapshot) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
const publish = (network = state.account!.network) => {
  state = { ...state, revision: state.revision + 1, account: { address: accounts[selected]!.address, network } };
  catalogue = { ...catalogue, revision: catalogue.revision + 1, active: { accountId: accounts[selected]!.id, networkId: network } };
  for (const listener of listeners) listener(state);
};
const choices = () => accounts.flatMap(account => networks.map(network => ({ label: account.label, networkName: network.name, symbol: network.symbol,
  scope: { id: `native:${account.id}:${network.id}`, accountId: account.id, accountType: account.type, accountAddress: account.address, network, guardian: false } })));
const reads: string[] = [], assets: string[] = [], prices: string[] = [], sends: string[] = [];
const initial = new URLSearchParams(window.location.search).get('filter');
if (initial && localStorage.getItem('pali.fixture.portfolio-filter') === null) localStorage.setItem('pali.fixture.portfolio-filter', initial);
const filter = createPortfolioFilter({ get: async () => localStorage.getItem('pali.fixture.portfolio-filter'), set: async value => localStorage.setItem('pali.fixture.portfolio-filter', value) });
const reader = { async readBalance(network: string, address: string) { reads.push(`${network}:${address}`); return { chainId: Number(getNativeNetwork(network).chainId), units: network === 'base' ? '2000000000000000000' : '1000000000000000000' }; } };
const model = new AccountPortfolioController({ source, choices, reader, filter,
  async assets(scope, _signal, check) { check(); assets.push(`${scope.network.id}:${scope.accountId}`); const extreme = new URLSearchParams(window.location.search).has('extreme'); return { tokens: [{ metadata: { contractAddress: '0x' + 'ab'.repeat(20), name: 'USD Coin', symbol: 'USDC', decimals: extreme ? 255 : 6 }, status: 'available', units: extreme ? '1' : '12000000' }], collectibles: [] }; },
  async nativePrice(choice) { prices.push(choice.scope.network.id); return 1000; }, async tokenPrice(choice) { prices.push(`token:${choice.scope.network.id}`); return 1; },
});
declare global { interface Window { __accountPortfolio: { reads: string[]; assets: string[]; prices: string[]; sends: string[]; backups(): number; nextAccount(): void } } }
window.__accountPortfolio = { reads, assets, prices, sends, backups: () => backups, nextAccount() { selected = 14; publish(); } };
export function NativeAccountOverviewFixture() {
  useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const shell = useRealShell('portfolio-fixture', () => 'portfolio-fixture', () => {});
  return <RealAppShell tab="wallet" onTab={() => {}} immersive={shell.immersive}>
    <NativeAccountOverview controller={model} portfolio={{ source, reader, accountLabel: accounts[selected]!.label, navigation: shell.navigation,
    onManageAccounts: window.__accountPortfolio.nextAccount, onExit() {}, onLock() {}, onViewRecovery() { backups++; }, onBackup() { backups++; }, onSend: unbacked ? undefined : () => {} }}
    selectNetwork={async (choice, check) => { check(); publish(choice.scope.network.id); check(); }}
    send={async (choice, token, check) => { check(); sends.push(`${choice.scope.network.id}:${token?.symbol ?? choice.symbol}`); }} />
  </RealAppShell>;
}
