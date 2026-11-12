import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assetIconIdentityKey, knownAssetIcon, trustedAssetIconUri, type AssetIconIdentity } from '../../../source/shared/assetIconIdentity.ts';
import { readAssetMarket } from '../../../source/shared/assetMarket.ts';
import { markNativeAssetIconFailed, nativeAssetIconKey, readNativeAssetIcon, rememberNativeAssetIcon, subscribeNativeAssetIcon } from '../src/portfolio/assetIconCache.ts';
import { nativeAssetMarketSource, rememberNativeAssetMarketIcon } from '../src/portfolio/nativeAssetMarket.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { Interface } from 'ethers/abi';
import { formatApprovalTokenAmount, parseApprovalAmount, summarizeApproval } from '../../../source/shared/approval.ts';
import { activityAssetIcon, utxoActivityAssetIcon } from '../src/activity/assetIcon.ts';
import type { ActivityRow } from '../src/activity/nativeActivity.ts';
import type { UtxoActivityRow } from '../src/core/utxoActivity.ts';

const contract = '0x' + '12'.repeat(20);
const hash = '0x' + '34'.repeat(32);
const identity = { kind: 'evm' as const, chainId: '1', contractAddress: contract };
const image = 'https://coin-images.coingecko.com/coins/images/123/small/token.png?1700000000';

test('known artwork requires exact chain and asset identity, never a symbol', () => {
  assert.equal(knownAssetIcon({ kind: 'spt', chainId: 57, assetGuid: '123456' }), 'syscoin');
  assert.equal(knownAssetIcon({ kind: 'spt', chainId: 5700, assetGuid: 123456 }), 'syscoin');
  assert.equal(knownAssetIcon({ kind: 'spt', chainId: 0, assetGuid: '123456' }), null);
  assert.equal(knownAssetIcon({ kind: 'spt', chainId: 57, assetGuid: '987654321' }), null);
  assert.equal(knownAssetIcon(identity), null);
  const zksys = { kind: 'evm' as const, chainId: '57057', contractAddress: '0x6EBb170f69D886916D9ee9E585CE39E626CbC35d' };
  assert.equal(knownAssetIcon(zksys), 'zksys');
  assert.equal(knownAssetIcon({ ...zksys, chainId: '57' }), null);
  assert.equal(knownAssetIcon({ ...zksys, chainId: '5700' }), null);
  assert.equal(knownAssetIcon({ ...zksys, decimals: 6 }), null);
  const usdc = { kind: 'evm' as const, chainId: '57057', contractAddress: '0xd501e86b1fc5823403b2ba995e2b8b78179236a6', decimals: 6 };
  assert.equal(knownAssetIcon(usdc), 'usdc');
  assert.equal(knownAssetIcon({ ...usdc, chainId: '1' }), null);
  assert.equal(knownAssetIcon({ ...usdc, decimals: 18 }), null);
  assert.equal(assetIconIdentityKey({ ...usdc, decimals: 18 }), null);
  const l1Usdc = { ...usdc, chainId: '5700', contractAddress: '0xb26b0ec48ed88347ed89874411cae4a1ecdf97fd' };
  assert.equal(knownAssetIcon(l1Usdc), 'usdc');
  assert.equal(knownAssetIcon({ ...l1Usdc, chainId: '57057' }), null);
  const sepolia = { ...usdc, chainId: 11155111, contractAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' };
  assert.equal(knownAssetIcon(sepolia), 'usdc');
  assert.equal(knownAssetIcon({ ...sepolia, chainId: 1 }), null);
  assert.equal(assetIconIdentityKey({ ...identity, contractAddress: contract.toUpperCase().replace('0X', '0x') }), assetIconIdentityKey(identity));
  for (const value of [{ ...identity, contractAddress: 'BTC' }, { ...identity, chainId: '01' }, { kind: 'spt', chainId: 57, assetGuid: 0 }])
    assert.equal(assetIconIdentityKey(value as AssetIconIdentity), null);
});

test('icon metadata permits only HTTPS raster paths on the existing CoinGecko CDN', () => {
  assert.equal(trustedAssetIconUri(image), image);
  for (const uri of [image.replace('https:', 'http:'), image.replace('.png', '.svg'), image.replace('.png', '.html'), image.replace('coin-images.coingecko.com', 'issuer.example'), image + '#fragment', image.replace('https://', 'https://evil@'), 'data:image/png;base64,eA=='])
    assert.equal(trustedAssetIconUri(uri), null);
});

test('public icon cache isolates exact network registration and notifies only its subscribers', () => {
  const key = nativeAssetIconKey(identity, hash)!;
  const other = nativeAssetIconKey({ ...identity, chainId: '10' }, hash)!;
  let changed = 0, unrelated = 0;
  const stop = subscribeNativeAssetIcon(key, () => changed++), stopOther = subscribeNativeAssetIcon(other, () => unrelated++);
  try {
    rememberNativeAssetIcon(identity, hash, image);
    rememberNativeAssetIcon(identity, hash, image);
    assert.equal(readNativeAssetIcon(key), image); assert.equal(changed, 1); assert.equal(unrelated, 0);
    assert.equal(readNativeAssetIcon(other), null);
    assert.equal(readNativeAssetIcon(nativeAssetIconKey(identity, '0x' + '56'.repeat(32))), null);
    rememberNativeAssetIcon(identity, hash, 'https://issuer.example/fake.png');
    assert.equal(readNativeAssetIcon(key), image);
  } finally { stop(); stopOther(); }
});

test('only an existing verified market result populates the captured registration icon', () => {
  const network = getNativeNetwork('ethereum');
  const asset = { kind: 'token' as const, networkId: network.id, registration: network, contractAddress: '0x' + '78'.repeat(20) };
  const result = readAssetMarket([{ id: 'fixture', image, current_price: 1, last_updated: new Date().toISOString() }], 'fixture', Date.now());
  assert(result); assert.equal(result.iconUri, image); assert(nativeAssetMarketSource(asset));
  rememberNativeAssetMarketIcon(asset, result);
  assert.equal(readNativeAssetIcon(nativeAssetIconKey({ kind: 'evm', chainId: '1', contractAddress: asset.contractAddress }, network.registrationHash)), image);
  const changed = { ...asset, registration: { ...network, registrationHash: '0x' + '99'.repeat(32) } };
  assert.equal(nativeAssetMarketSource(changed), null);
  rememberNativeAssetMarketIcon(changed, result);
  assert.equal(readNativeAssetIcon(nativeAssetIconKey({ kind: 'evm', chainId: '1', contractAddress: asset.contractAddress }, changed.registration.registrationHash)), null);
});

test('NativeAssetIcon shows a found image, falls back after decode failure, and never brands symbol spoofing', () => {
  const f = screenFixture(new URL('../src/ui.tsx', import.meta.url), 'NativeAssetIcon', {
    './platform/localization': nativeTranslationFixture,
    './screens/IdleActivityBoundary': { IdlePressable: 'Pressable' }, './screens/useWelcomeBackdropMotion': { useWelcomeBackdropMotion() {} },
    '../../../source/shared/assetIconIdentity': { knownAssetIcon }, './portfolio/assetIconCache': { markNativeAssetIconFailed, nativeAssetIconKey, readNativeAssetIcon, subscribeNativeAssetIcon },
    'react-native': { Image: 'Image', StyleSheet: { create: (value: unknown) => value } }, 'react-native-svg': {},
  });
  try {
    const props = { identity, registrationHash: hash, size: 32, symbol: 'BTC' };
    const found = f.render(props); assert.equal(found.type, 'Image'); assert.equal(found.props.source.uri, image);
    found.props.onError();
    const fallback = f.render(props); assert.equal((fallback.type as Function).name, 'Coin'); assert.equal(fallback.props.id, 'unknown-asset'); assert.equal(fallback.props.fallbackSymbol, 'BTC');
    const wrong = f.render({ ...props, identity: { ...identity, chainId: '10' } }); assert.equal(wrong.props.id, 'unknown-asset');
    const known = f.render({ identity: { kind: 'spt', chainId: 57, assetGuid: '123456' }, symbol: 'Untrusted name' }); assert.equal(known.props.id, 'syscoin');
  } finally { f.close(); }
});

test('failed images survive remounts and retry only after a later metadata refresh beyond cooldown', () => {
  const asset = { ...identity, contractAddress: '0x' + '98'.repeat(20) };
  const key = nativeAssetIconKey(asset, hash)!;
  rememberNativeAssetIcon(asset, hash, image, 1_000);
  markNativeAssetIconFailed(key, image, 1_000);
  assert.equal(readNativeAssetIcon(key), null);
  rememberNativeAssetIcon(asset, hash, image, 300_999);
  assert.equal(readNativeAssetIcon(key), null);
  rememberNativeAssetIcon(asset, hash, image, 301_000);
  assert.equal(readNativeAssetIcon(key), image);
  const changedUri = image.replace('token.png', 'replacement.png');
  rememberNativeAssetIcon(asset, hash, changedUri, 301_001);
  markNativeAssetIconFailed(key, image, 301_002);
  assert.equal(readNativeAssetIcon(key), changedUri);
  const changedScope = nativeAssetIconKey(asset, '0x' + '99'.repeat(32));
  assert.equal(readNativeAssetIcon(changedScope), null);
});

test('public icon cache remains bounded', () => {
  const keys: string[] = [];
  for (let index = 1; index <= 70; index++) {
    const next = { kind: 'evm' as const, chainId: '1', contractAddress: '0x' + index.toString(16).padStart(40, '0') };
    keys.push(nativeAssetIconKey(next, hash)!); rememberNativeAssetIcon(next, hash, image);
  }
  assert.equal(keys.filter(key => readNativeAssetIcon(key) !== null).length, 64);
  assert.equal(readNativeAssetIcon(keys[0]!), null); assert.equal(readNativeAssetIcon(keys.at(-1)!), image);
});

test('Activity icon requires a full, unambiguous asset identity in the displayed chain', () => {
  const row = { hash: '0x' + 'aa'.repeat(32), checking: false, unavailable: false };
  const local = { chainId: '1', registrationHash: hash, token: { contractAddress: contract, decimals: 6, symbol: 'BTC' } };
  assert.equal(activityAssetIcon(row, '1', hash), undefined, 'Symbol-free native rows retain the direction icon');
  assert.deepEqual(activityAssetIcon({ ...row, local } as ActivityRow, '1', hash), { ...identity, decimals: 6 });
  assert.equal(activityAssetIcon({ ...row, local } as ActivityRow, '10', hash), undefined);
  assert.equal(activityAssetIcon({ ...row, local } as ActivityRow, '1', '0x' + '99'.repeat(32)), undefined);
  const indexed = { ...row, display: { isErc20Transfer: true }, indexed: { tokenTransfer: { contractAddress: contract, decimals: '6', chainId: '1' } } } as ActivityRow;
  assert.deepEqual(activityAssetIcon(indexed, '1'), { ...identity, decimals: 6 });
  assert.equal(activityAssetIcon(indexed, '10'), undefined);
  assert.deepEqual(activityAssetIcon({ ...indexed, local: { ...local, token: { ...local.token, contractAddress: '0x' + '56'.repeat(20) } } } as ActivityRow, '1', hash), { ...identity, decimals: 6 });
  assert.equal(activityAssetIcon({ ...indexed, display: { isErc20Transfer: false, isNft: false }, local } as ActivityRow, '1', hash), undefined);
  const event = { contractAddress: contract, id: 'log-0', logIndex: '0', from: contract, to: contract, amountUnits: '1' };
  const observation = { hash: row.hash, from: contract, to: contract, valueUnits: '0', nonce: '0', timestamp: null, block: null,
    status: 'confirmed' as const, feeUnits: null, events: [event, event] };
  assert.deepEqual(activityAssetIcon({ ...row, observation } as ActivityRow, '1'), identity);
  assert.equal(activityAssetIcon({ ...row, observation: { ...observation, valueUnits: '1' } } as ActivityRow, '1'), undefined);
  assert.equal(activityAssetIcon({ ...row, observation: { ...observation, events: [event, { ...event, contractAddress: '0x' + '56'.repeat(20) }] } }, '1'), undefined);
  assert.equal(activityAssetIcon({ ...row, observation: { ...observation, events: [{ symbol: 'USDC' }] } } as unknown as ActivityRow, '1'), undefined);
  const spt = { hasAssetData: true, assetAmount: { assetGuid: '123456', decimals: 8, symbol: 'Untrusted name' } } as UtxoActivityRow;
  assert.equal(knownAssetIcon(utxoActivityAssetIcon(spt, 57)!), 'syscoin');
  assert.equal(knownAssetIcon(utxoActivityAssetIcon(spt, 0)!), null);
  assert.equal(utxoActivityAssetIcon({ hasAssetData: true, assetAmount: { symbol: 'SYSX' } } as UtxoActivityRow, 57), undefined);
});

test('approval artwork retains the exact spender, allowance and edit callback', () => {
  const tokenContract = '0xd501e86b1fc5823403b2ba995e2b8b78179236a6';
  const data = new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [contract, 1234567]);
  const summary = summarizeApproval(data, tokenContract, { standard: 'ERC-20', token: { contractAddress: tokenContract, name: 'USD Coin', symbol: 'USDC', decimals: 6 } });
  assert(summary);
  const f = screenFixture(new URL('../src/screens/ApprovalReview.tsx', import.meta.url), 'ApprovalReview', {
    '../platform/localization': nativeTranslationFixture,
    'react-native': { StyleSheet: { create: (value: unknown) => value }, View: 'View' },
    '../../../../source/shared/approval': { formatApprovalTokenAmount, parseApprovalAmount },
    '../ui': { colors: {}, ...Object.fromEntries(['Button', 'Card', 'Coin', 'Text'].map(name => [name, name])) },
    './IdleActivityBoundary': { IdleTextInput: 'Input' },
  });
  const edited: string[] = [], editing: boolean[] = [];
  const props = { summary, transaction: { data }, chainId: '57057', registrationHash: hash, disabled: false,
    edit: async (value: string) => { edited.push(value); }, onEditingChange: (value: boolean) => editing.push(value) };
  try {
    let nodes = screenElements(f.render(props));
    const icon = nodes.find(node => node.type === 'Coin'); assert(icon);
    assert.equal(icon.props.asset.contractAddress, tokenContract); assert.equal(icon.props.asset.chainId, '57057');
    assert.equal(icon.props.asset.decimals, 6); assert.equal(icon.props.registrationHash, hash);
    assert(nodes.some(node => node.children.includes(contract))); assert(nodes.some(node => node.children.includes('1.234567 USDC')));
    nodes.find(node => node.props.title === 'Edit spending limit')!.props.onPress();
    nodes = screenElements(f.render(props)); nodes.find(node => node.type === 'Input')!.props.onChangeText('2.5');
    nodes = screenElements(f.render(props)); nodes.find(node => node.props.title === 'Apply limit')!.props.onPress();
    assert.deepEqual(edited, ['2.5']); assert.deepEqual(editing, [true]);
  } finally { f.close(); }
});
