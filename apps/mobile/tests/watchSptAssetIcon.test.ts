import assert from 'node:assert/strict';
import test from 'node:test';
import { knownAssetIcon } from '../../../source/shared/assetIconIdentity.ts';
import * as inventory from '../../../source/shared/sptInventory.ts';
import { formatBalanceDelta, formatBaseUnits } from '../src/core/amounts.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

for (const networkId of ['syscoin', 'utxo:5700']) test(`watch-only ${networkId} preserves known SPT artwork in list and detail`, () => {
  const network = getUtxoNetwork(networkId);
  const address = 'public-watch-address';
  const holding = { assetGuid: '123456', decimals: 8, symbol: 'SYSX', confirmedUnits: '123000000', pendingDeltaUnits: '0' };
  const account = { id: 'watch', name: 'Watch account', addresses: { [network.id]: address } };
  const snapshot = { status: 'ready', generation: 1, accounts: [account], selectedAccountId: account.id, selectedNetworkId: network.id,
    capabilities: { receive: true }, balance: { kind: 'utxo', status: 'available', units: '100000000', pendingDeltaUnits: '0', assets: [holding] } };
  const authority = { getSnapshot: () => snapshot, subscribe: () => () => undefined, getNetwork: () => network,
    getAccountNetworks: () => [network], cancelRefresh() {}, refresh: async () => { assert.fail('Rendering cached holdings must not fetch'); } };
  const ui = { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'IconButton', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} };
  const native = { View: 'View', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value },
    useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: {}, Share: {} };
  const privacy = { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden: false }) };
  const watch = screenFixture(new URL('../src/screens/WatchAccountPortfolio.tsx', import.meta.url), 'WatchAccountPortfolio', {
    '../platform/balancePrivacy': privacy, '../activity/activityAmountLabel': { compactActivityAmountLabel },
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode', '../core/amounts': { formatBalanceDelta, formatBaseUnits },
    '../custody/networkContext': { getNativeNetwork() { assert.fail('A UTXO watch account must keep its own network'); } },
    '../custody/testnetFaucet': {}, '../portfolio/useNativeCoinQuote': { useNativeCoinQuote: () => ({ supported: false, quote: null }) },
    './CopyableAddress': { CopyableAddress: 'CopyableAddress' },
    './PortfolioQuote': { PortfolioQuote: 'PortfolioQuote' }, '../portfolio/AssetMarketCard': { AssetMarketCard: 'AssetMarketCard' },
    './NativeSptAssets': { NativeSptAssets: 'NativeSptAssets' }, '../../../../source/shared/sptInventory': inventory,
    './TestnetFaucetCard': {}, '../ui': ui,
  });
  const tokens = screenFixture(new URL('../src/screens/NativeSptAssets.tsx', import.meta.url), 'NativeSptAssets', {
    '../platform/balancePrivacy': privacy, 'react-native': native, '../ui': ui,
    '../core/amounts': { formatBalanceDelta, formatBaseUnits }, '../../../../source/shared/sptInventory': inventory,
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
  });
  try {
    const panel = screenElements(watch.render({ authority, onAccounts() {}, onExit() {}, onLock() {} }))
      .find(node => node.type === 'NativeSptAssets');
    assert(panel);
    assert.equal(panel.props.onSend, undefined, 'Watch-only holdings cannot expose Send');
    const row = screenElements(tokens.render(panel.props)).find(node => node.type === 'Row'); assert(row);
    assert.equal(knownAssetIcon(row.props.icon.props.asset), 'syscoin');
    row.props.onPress();
    const detailIcon = screenElements(tokens.render(panel.props)).find(node => node.type === 'Coin'); assert(detailIcon);
    assert.equal(knownAssetIcon(detailIcon.props.asset), 'syscoin');
    assert.equal(detailIcon.props.asset.chainId, network.chainId);
  } finally { tokens.close(); watch.close(); }
});
