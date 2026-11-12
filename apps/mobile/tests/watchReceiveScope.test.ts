import assert from 'node:assert/strict';
import test from 'node:test';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { formatBalanceDelta, formatBaseUnits } from '../src/core/amounts.ts';
import { createPublicAccountStorage, PUBLIC_ACCOUNTS_KEY } from '../src/core/publicAccountStorage.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import type { StoredWatchAccount } from '../src/core/watchAccountCodec.ts';
import { WatchOnlyAuthority } from '../src/core/watchOnlyAuthority.ts';
import { keyRecord, UTXO_ADDRESSES, XPUB } from './publicWatchFixtures.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

for (const kind of ['address', 'xpub', 'descriptor'] as const) test(`${kind} watch Receive shows its actual monitoring scope without exposing the source`, async () => {
  const network = getUtxoNetwork('bitcoin');
  const record: StoredWatchAccount = kind === 'address'
    ? { kind: 'address', id: 'address', name: 'Address', addresses: { bitcoin: UTXO_ADDRESSES.bitcoin } }
    : keyRecord(kind, 'bitcoin', kind === 'xpub' ? XPUB : `sh(wpkh(${XPUB}/0/*))`);
  const storage = createPublicAccountStorage({
    async get(key) { return key === PUBLIC_ACCOUNTS_KEY ? JSON.stringify({ version: 1, records: [record] }) : null; },
    async set() { assert.fail('Viewing Receive must not write'); },
  });
  let reads = 0;
  const read = async () => {
    reads++;
    return { networkId: network.id, kind: 'utxo' as const, chainId: network.chainId, genesisHash: network.genesisHash,
      confirmedUnits: '1', pendingDeltaUnits: '0', unconfirmedTransactions: 0, observedHeight: 1 };
  };
  const authority = await WatchOnlyAuthority.openRecords({ repository: storage.records, signal: new AbortController().signal,
    reader: { readBalance: async () => { assert.fail('No EVM read'); }, readUtxoAccount: read, readUtxoBalance: read } });
  assert.equal(authority.getUtxoWatchScope(), null);
  authority.unlock(); await authority.refresh();
  assert.equal(authority.getUtxoWatchScope(), kind === 'address' ? 'address' : 'account');
  const host = screenFixture(new URL('../src/screens/WatchAccountPortfolio.tsx', import.meta.url), 'WatchAccountPortfolio', {
    '../platform/balancePrivacy': { HIDDEN_BALANCE: 'hidden', useBalancePrivacy: () => ({ hidden: false }) },
    '../activity/activityAmountLabel': { compactActivityAmountLabel },
    'react-native': { View: 'View', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value },
      useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: {}, Share: {} },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode',
    '../core/amounts': { formatBalanceDelta, formatBaseUnits },
    '../custody/networkContext': { getNativeNetwork() { assert.fail('No EVM network'); } },
    '../custody/testnetFaucet': {}, '../portfolio/useNativeCoinQuote': { useNativeCoinQuote: () => ({ supported: false, quote: null }) },
    './CopyableAddress': { CopyableAddress: 'CopyableAddress' },
    './PortfolioQuote': { PortfolioQuote: 'PortfolioQuote' }, '../portfolio/AssetMarketCard': { AssetMarketCard: 'AssetMarketCard' },
    './NativeSptAssets': { NativeSptAssets: 'NativeSptAssets' }, '../../../../source/shared/sptInventory': { supportsSptUtxoChain: () => false },
    './TestnetFaucetCard': {}, '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'IconButton', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
  });
  const props = { authority, onAccounts() {}, onExit() {}, onLock() {} };
  try {
    screenElements(host.render(props)).find(node => node.type === 'Button' && node.props.title === 'Receive')!.props.onPress();
    const receive = host.render(props), elements = screenElements(receive);
    assert.equal(elements.some(node => node.type === 'Notice' && node.props.title === 'One address only'), kind === 'address');
    assert(elements.some(node => node.type === 'QRCode' && node.props.value === authority.getSnapshot().accounts[0]!.addresses.bitcoin));
    assert.equal(JSON.stringify(receive).includes(XPUB), false);
    assert.equal(JSON.stringify(authority.getSnapshot()).includes(XPUB), false);
    assert.equal(reads, 1, 'The scope projection and Receive screen require no additional reads');
    authority.lock();
    assert.equal(authority.getUtxoWatchScope(), null);
  } finally { host.close(); }
});
