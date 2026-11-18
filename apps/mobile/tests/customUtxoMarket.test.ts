import assert from 'node:assert/strict';
import test from 'node:test';
import { getUtxoNetwork, projectUtxoRegistration, utxoRegistrationData, UTXO_NETWORKS } from '../src/core/utxoNetworks.ts';
import { nativeAssetMarketSource, createNativeAssetMarketReader } from '../src/portfolio/nativeAssetMarket.ts';
import { nativeCoinQuoteSource } from '../src/portfolio/nativeCoinQuote.ts';
import { formatBalanceDelta, formatBaseUnits } from '../src/core/amounts.ts';
import { compactActivityAmountLabel } from '../src/activity/activityAmountLabel.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import * as inventory from '../../../source/shared/sptInventory.ts';
import * as marketGeometry from '../../../source/shared/assetMarket.ts';

const source = (relative: string) => new URL('../../../' + relative, import.meta.url);
const bitcoin = getUtxoNetwork('bitcoin');
const custom = projectUtxoRegistration({ ...utxoRegistrationData(bitcoin),
  id: `utxo:custom:${'12'.repeat(16)}`, endpoint: 'https://public-bitcoin-fixture.invalid',
  name: 'Bitcoin alternate provider' });
const ui = { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'IconButton', 'Notice', 'Row', 'Screen', 'Text'].map(name => [name, name])), colors: {}, styles: {} };
const native = { View: 'View', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => ({ width: 390, fontScale: 1 }), Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: {}, Share: {} };
const privacy = { HIDDEN_BALANCE: '••••', useBalancePrivacy: () => ({ hidden: false }) };

test('admitted custom Bitcoin retains the same known market identity as the built-in chain', () => {
  assert.equal(custom.chainId, bitcoin.chainId);
  assert.equal(custom.genesisHash, bitcoin.genesisHash);
  assert.equal(custom.symbol, 'BTC');
  assert.equal(custom.testnet, false);
  assert.deepEqual(nativeCoinQuoteSource(custom), { kind: 'utxo', endpoint: custom.endpoint });
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: bitcoin.id }), { kind: 'native', id: 'bitcoin' });
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: custom.id }), null);
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: custom.id, registration: custom }), { kind: 'native', id: 'bitcoin' });
  assert.equal(nativeAssetMarketSource({ kind: 'token', networkId: custom.id, registration: custom }), null);
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: bitcoin.id, registration: custom }), null);
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: custom.id, registration: { ...custom } }), null);
});

test('normal watch-account detail forwards its admitted UTXO registration into the market card', () => {
  const account = { id: 'watch-fixture', name: 'Public Bitcoin watch', addresses: { [custom.id]: 'public-address' } };
  const snapshot = { status: 'ready', generation: 1, accounts: [account], selectedAccountId: account.id, selectedNetworkId: custom.id,
    capabilities: { receive: true }, balance: { kind: 'utxo', status: 'available', units: '100000000', pendingDeltaUnits: '0', assets: [] } };
  const quoteRegistrations: unknown[] = [];
  const authority = { getSnapshot: () => snapshot, subscribe: () => () => undefined, getNetwork: () => custom,
    getNetworkRegistration: () => custom, getAccountNetworks: () => [custom], cancelRefresh() {},
    refresh: async () => { assert.fail('A cached public render does not refresh'); } };
  const watch = screenFixture(source('apps/mobile/src/screens/WatchAccountPortfolio.tsx'), 'WatchAccountPortfolio', {
    '../platform/balancePrivacy': privacy, '../activity/activityAmountLabel': { compactActivityAmountLabel },
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-clipboard': {}, 'react-native-qrcode-svg': 'QRCode', '../core/amounts': { formatBalanceDelta, formatBaseUnits },
    '../custody/networkContext': { getNativeNetwork() { assert.fail('UTXO watch keeps its own network'); } },
    '../custody/testnetFaucet': {}, '../portfolio/useNativeCoinQuote': { useNativeCoinQuote: (registration: unknown) => { quoteRegistrations.push(registration); return { supported: true, quote: 'fixture quote' }; } },
    './CopyableAddress': { CopyableAddress: 'CopyableAddress' }, './PortfolioQuote': { PortfolioQuote: 'PortfolioQuote' },
    '../portfolio/AssetMarketCard': { AssetMarketCard: 'AssetMarketCard' }, './NativeSptAssets': { NativeSptAssets: 'NativeSptAssets' },
    '../../../../source/shared/sptInventory': inventory, './TestnetFaucetCard': {}, '../ui': ui,
  }, { AbortController });
  let reads = 0;
  const card = screenFixture(source('apps/mobile/src/portfolio/AssetMarketCard.tsx'), 'AssetMarketCard', {
    'react-native': native, 'react-native-svg': { default: 'Svg', Circle: 'Circle', Line: 'Line', Path: 'Path' },
    '../../../../source/shared/assetMarket.ts': marketGeometry,
    '../platform/fiatPreferences.ts': { useFiatCurrency: () => ({ status: 'ready', currency: 'usd' }) },
    '../platform/http': { walletFetch: () => { assert.fail('No live HTTP'); } }, '../ui': ui,
    './nativeAssetMarket.ts': { nativeAssetMarketSource, nativeAssetMarketReaders: () => ({ history: () => { reads++; return Promise.resolve(null); } }),
      nativeAssetMarketNow: () => 0, rememberNativeAssetMarketIcon() {} },
  }, { AbortController });
  try {
    const props = { authority, onAccounts() {}, onExit() {}, onLock() {} };
    const assetRow = screenElements(watch.render(props)).find(node => node.type === 'Row' && node.props.title === 'BTC');
    assert(assetRow); assetRow.props.onPress();
    const market = screenElements(watch.render(props)).find(node => node.type === 'AssetMarketCard');
    assert(market);
    assert.equal(market.props.asset.networkId, custom.id);
    assert.equal(market.props.asset.registration, custom);
    assert(quoteRegistrations.every(value => value === custom));
    const rendered = card.render(market.props);
    const strings = JSON.stringify(rendered);
    assert.doesNotMatch(strings, /Market data is unavailable for this asset/i);
    assert.equal(reads, 1);
  } finally { card.close(); watch.close(); }
});

test('healthy Bitcoin market control reads quote and history through the actual reader', async () => {
  const urls: string[] = [];
  const now = Date.now();
  const read = createNativeAssetMarketReader(async (url: string) => {
    urls.push(url);
    return Response.json(url.includes('/market_chart?') ? { prices: [[now - 60_000, 65000], [now, 66000]] }
      : [{ id: 'bitcoin', current_price: 66000, last_updated: new Date(now).toISOString() }]);
  }, 'history');
  const builtIn = nativeAssetMarketSource({ kind: 'native', networkId: bitcoin.id });
  assert(builtIn);
  const result = await read(builtIn, 'usd', new AbortController().signal);
  assert.equal(result?.data.price, 66000);
  assert.deepEqual(result?.data.prices, [65000, 66000]);
  assert.equal(urls.length, 2);
});

test('custom market identity comes from the admitted chain, with testnets and forged registrations unavailable', () => {
  const renamed = projectUtxoRegistration({ ...utxoRegistrationData(bitcoin), id: `utxo:custom:${'34'.repeat(16)}`,
    endpoint: 'https://renamed-bitcoin-fixture.invalid', name: 'Ethereum' });
  assert.deepEqual(nativeAssetMarketSource({ kind: 'native', networkId: renamed.id, registration: renamed }), { kind: 'native', id: 'bitcoin' });
  const testnet = UTXO_NETWORKS.find(network => network.testnet); assert(testnet);
  const registeredTestnet = projectUtxoRegistration({ ...utxoRegistrationData(testnet), id: `utxo:custom:${'56'.repeat(16)}`,
    endpoint: 'https://testnet-fixture.invalid', name: 'Bitcoin' });
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: registeredTestnet.id, registration: registeredTestnet }), null);
  assert.equal(nativeAssetMarketSource({ kind: 'native', networkId: custom.id, registration: { ...custom, symbol: 'ETH' } }), null);
});
