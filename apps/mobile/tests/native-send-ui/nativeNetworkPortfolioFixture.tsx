import { UTXO_NETWORKS } from '../../src/core/utxoNetworks.ts';
import React, { useState } from 'react';
import type { CustodySnapshot } from '../../src/custody/types';
import type { NativeWalletCatalogueSnapshot } from '../../src/custody/walletCatalogue';
import { createNativeNetworkView } from '../../src/custody/networkView';
import { getNativeNetwork, NATIVE_NETWORKS, type EvmNetworkId } from '../../src/custody/networkContext';
import { nativeAccountId } from '../../src/custody/accountIdentity';
import { findUtxoNetwork, getUtxoNetwork, type UtxoNetworkId } from '../../src/core/utxoNetworks';
import { UTXO_ADDRESSES } from '../publicWatchFixtures';
import { NativePortfolio } from '../../src/screens/NativePortfolio';
import { NativeNetworks } from '../../src/screens/NativeNetworks';
import type { BalanceReader } from '../../src/core/watchOnlyAuthority';

const utxoAddresses: Partial<Record<UtxoNetworkId, string>> = UTXO_ADDRESSES;
const address = '0x52908400098527886E0F7030069857D2E4169EE7';
let state = Object.freeze<CustodySnapshot>({ phase: 'ready', revision: 1, presence: 'existing', backup: 'confirmed', account: { network: 'ethereum', address }, error: null });
let catalogue = Object.freeze<NativeWalletCatalogueSnapshot>({ revision: 1, networks: NATIVE_NETWORKS, utxoNetworks: UTXO_NETWORKS,
  accounts: [{ id: 'hd:60:0', type: 'HDAccount', index: 0, slip44: 60, address, label: 'Account 1' }],
  active: { accountId: 'hd:60:0', networkId: 'ethereum' } });
const listeners = new Set<(value: CustodySnapshot) => void>();
const reads: string[] = [];
let sends = 0;
type SysxFixture = 'held' | 'unavailable' | 'empty';
let sysxFixture: SysxFixture = 'held';
const publish = () => { for (const listener of listeners) listener(state); };
const authority = {
  getSnapshot: () => state,
  getCatalogue: () => state.phase === 'ready' ? catalogue : null,
  subscribe(listener: (value: CustodySnapshot) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async selectNetwork(id: string, revision: number, catalogueRevision: number) {
    const utxo = findUtxoNetwork(id);
    const network = utxo ?? getNativeNetwork(id);
    const selectedAddress = utxo ? utxoAddresses[utxo.id] : address;
    if (!selectedAddress) throw Error('Unsupported fixture network');
    if (state.phase !== 'ready' || revision !== state.revision || catalogueRevision !== catalogue.revision) throw Error('CANCELLED');
    state = Object.freeze({ ...state, revision: state.revision + 1, phase: 'authenticating', account: null }); publish();
    await Promise.resolve();
    const slip44 = utxo?.slip44 ?? 60;
    const accountId = nativeAccountId('HDAccount', 0, slip44);
    catalogue = Object.freeze<NativeWalletCatalogueSnapshot>({ ...catalogue, revision: catalogue.revision + 1,
      accounts: [{ id: accountId, type: 'HDAccount', index: 0, slip44, address: selectedAddress, label: 'Account 1' }],
      active: { accountId, networkId: network.id } });
    state = Object.freeze({ ...state, phase: 'ready', account: { network: network.id, address: selectedAddress } }); publish();
  },
  cancelAccountOperation() {},
};
const networks = createNativeNetworkView(authority, { utxoSendAvailable: true });
const reader: BalanceReader = {
  async readBalance(id) {
    reads.push(id); return { chainId: Number(getNativeNetwork(id).chainId), units: '1234000000000000000' };
  },
  async readUtxoBalance(scope, selectedAddress) {
    const id = typeof scope === 'string' ? scope : scope.id;
    if (selectedAddress !== utxoAddresses[id]) throw Error('Wrong account');
    const network = getUtxoNetwork(id);
    reads.push(id);
    return { kind: 'utxo', networkId: id, chainId: network.chainId, genesisHash: network.genesisHash,
      confirmedUnits: '123400000', pendingDeltaUnits: '-123', unconfirmedTransactions: 1, observedHeight: 123,
      ...(id === 'syscoin' && sysxFixture !== 'unavailable' ? { sysx: sysxFixture === 'held'
        ? { confirmedUnits: '9007199254740995', pendingDeltaUnits: '-1' }
        : { confirmedUnits: '0', pendingDeltaUnits: '0' } } : {}) };
  },
};

declare global { interface Window { __nativeNetworkPortfolio: { reads(): readonly string[]; sends(): number; select(id: EvmNetworkId): Promise<void>; setSysx(value: SysxFixture): void }; } }
window.__nativeNetworkPortfolio = { reads: () => [...reads], sends: () => sends,
  select: (id) => authority.selectNetwork(id, state.revision, catalogue.revision), setSysx: (value) => { sysxFixture = value; } };
export function NativeNetworkPortfolioFixture() {
  const [view, setView] = useState<'portfolio' | 'networks'>('portfolio');
  return view === 'networks' ? <NativeNetworks controller={networks} onBack={() => setView('portfolio')} /> :
    <NativePortfolio source={authority} reader={reader} onManageNetworks={() => setView('networks')}
      onSend={() => { sends++; }} onExit={() => undefined} onLock={() => undefined} onViewRecovery={() => undefined} />;
}
