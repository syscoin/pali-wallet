import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeErc20Address } from '../src/portfolio/erc20Metadata.ts';
import { normalizeNftTokenId } from '../../../source/utils/nftTokenId.ts';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

const contractAddress = '0x1111111111111111111111111111111111111111';
const maximumId = ((1n << 256n) - 1n).toString();
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
type Enumeration = { tokenIds: readonly string[]; hasMore: boolean; method: 'enumeration' | 'manual'; totalOwned?: string };
const deferred = <T,>() => Promise.withResolvers<T>();

function fixture(options: { item?: object; hidden?: boolean; enumerate?: (signal: AbortSignal) => Promise<Enumeration>;
  check?: (query: object, signal: AbortSignal) => Promise<{ tokenId: string; units: string }> } = {}) {
  const enumerations: { query: object; signal: AbortSignal }[] = [], checks: object[] = [], saves: object[] = [];
  let leave: (() => void) | null = null;
  const host = screenFixture(new URL('../src/screens/NativeTokens.tsx', import.meta.url), 'CollectibleOwnership', {
    '../platform/balancePrivacy': { useBalancePrivacy: () => ({ hidden: options.hidden ?? false }), HIDDEN_BALANCE: 'Hidden' },
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    'react-native': { ActivityIndicator: 'ActivityIndicator', View: 'View', Keyboard: { dismiss() {} }, StyleSheet: { create: (value: unknown) => value } },
    '../../../../source/shared/erc20': { formatTokenUnits() { throw Error('Not used'); } },
    '../../../../source/utils/nftTokenId': { normalizeNftTokenId },
    '../portfolio/erc20Metadata': { normalizeErc20Address },
    '../portfolio/AssetMarketCard': { AssetMarketCard: 'AssetMarketCard' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Icon', 'IconButton', 'Notice', 'Text'].map(name => [name, name])), colors: {}, styles: {} },
  }, { AbortController });
  const props = {
    item: options.item ?? null, network: 'Ethereum', busy: false, canCheck: true,
    async enumerate(query: object, signal: AbortSignal) {
      enumerations.push({ query: JSON.parse(JSON.stringify(query)), signal });
      return options.enumerate ? options.enumerate(signal) : { tokenIds: ['0', maximumId], hasMore: false, method: 'enumeration' as const };
    },
    async check(query: object, signal: AbortSignal) {
      checks.push(JSON.parse(JSON.stringify(query)));
      return options.check ? options.check(query, signal) : { tokenId: '0', units: '1' };
    },
    async onSave(ticket: object) { saves.push(ticket); },
    onLeaveChange(next: (() => void) | null) { leave = next; },
  };
  const render = () => screenElements(host.render(props));
  return { render, enumerations, checks, saves, leave: () => leave?.(), close: host.close };
}
function button(tree: ScreenElement[], title: string) {
  const found = tree.find(node => node.type === 'Button' && node.props.title === title);
  assert(found, title); return found;
}
function input(tree: ScreenElement[], label: string) {
  const found = tree.find(node => node.type === 'Input' && node.props.accessibilityLabel === label);
  assert(found, label); return found;
}
function manual(f: ReturnType<typeof fixture>) {
  input(f.render(), 'Collectible contract address').props.onChangeText(contractAddress);
  const standard = f.render().find(node => node.type === 'Pressable' && screenElements(node).some(child => child.children.includes('ERC-721')));
  assert(standard); standard.props.onPress();
}

test('manual contract enumeration is explicit and selected zero or large IDs check exact ownership without saving', async () => {
  for (const tokenId of ['0', maximumId]) {
    const f = fixture();
    try {
      manual(f); assert.equal(f.enumerations.length, 0);
      button(f.render(), 'Find token IDs').props.onPress(); await tick();
      assert.deepEqual(f.enumerations[0]?.query, { contractAddress, tokenStandard: 'ERC-721' });
      const selected = button(f.render(), `Token ID ${tokenId}`);
      assert.equal(selected.props.title, `Token ID ${tokenId}`);
      assert.deepEqual(f.checks, []); assert.deepEqual(f.saves, []);
      selected.props.onPress(); await tick();
      assert.deepEqual(f.checks, [{ contractAddress, tokenStandard: 'ERC-721', tokenId }]);
      assert.equal(input(f.render(), 'Token ID').props.value, tokenId);
      assert.deepEqual(f.saves, []);
      selected.props.onPress(); assert.equal(f.checks.length, 1, 'Old suggestion callbacks are retired');
    } finally { f.close(); }
  }
});

for (const item of [
  { contractAddress, tokenStandard: 'ERC-721' },
  { contractAddress, tokenStandard: 'ERC-721', name: 'Explorer collection', units: '12' },
]) test(`opening a known ${'name' in item ? 'explorer' : 'saved'} collection enumerates once`, async () => {
  const f = fixture({ item });
  try {
    f.render(); await tick(); f.render(); f.render();
    assert.equal(f.enumerations.length, 1);
    assert(button(f.render(), 'Token ID 0'));
    assert.deepEqual(f.checks, []); assert.deepEqual(f.saves, []);
  } finally { f.close(); }
});

test('a fixed ID and ERC1155 retain their manual ownership path without enumeration', async () => {
  for (const item of [
    { contractAddress, tokenStandard: 'ERC-721', name: 'One item', tokenId: '0', units: '1' },
    { contractAddress, tokenStandard: 'ERC-1155', tokenId: '0' },
  ]) {
    const f = fixture({ item });
    try {
      f.render(); await tick(); assert.equal(f.enumerations.length, 0);
      assert(!f.render().some(node => node.type === 'Button' && String(node.props.title).includes('token IDs')));
      button(f.render(), 'Check ownership').props.onPress(); await tick(); assert.equal(f.checks.length, 1);
    } finally { f.close(); }
  }
});

for (const result of [
  { tokenIds: [], hasMore: false, method: 'manual' as const },
  { tokenIds: [], hasMore: false, method: 'enumeration' as const },
  { tokenIds: Array.from({ length: 10 }, (_, index) => String(index)), hasMore: true, method: 'enumeration' as const },
]) test(`enumeration ${result.method} with ${result.tokenIds.length} results preserves manual input`, async () => {
  const f = fixture({ enumerate: async () => result });
  try {
    manual(f); button(f.render(), 'Find token IDs').props.onPress(); await tick();
    const tree = f.render(); assert(input(tree, 'Token ID'));
    assert.equal(tree.filter(node => node.type === 'Button' && /^Token ID /.test(node.props.title)).length, result.tokenIds.length);
    assert(tree.some(node => node.type === 'Text' && node.children.some(child => typeof child === 'string' && child.includes(
      result.method === 'manual' ? 'lookup is unavailable' : result.hasMore ? 'first 10' : 'No token IDs'
    ))));
    input(tree, 'Token ID').props.onChangeText('99');
    button(f.render(), 'Check ownership').props.onPress(); await tick();
    assert.deepEqual(f.checks, [{ contractAddress, tokenStandard: 'ERC-721', tokenId: '99' }]);
  } finally { f.close(); }
});

for (const boundary of ['edit', 'leave', 'unmount'] as const) test(`${boundary} cancels enumeration and discards its late results`, async () => {
  const pending = deferred<Enumeration>(), f = fixture({ enumerate: () => pending.promise });
  manual(f); button(f.render(), 'Find token IDs').props.onPress();
  assert(button(f.render(), 'Finding token IDs…').props.disabled);
  assert(button(f.render(), 'Check ownership').props.disabled);
  if (boundary === 'edit') input(f.render(), 'Token ID').props.onChangeText('8');
  else if (boundary === 'leave') f.leave();
  else f.close();
  assert.equal(f.enumerations[0]?.signal.aborted, true);
  pending.resolve({ tokenIds: ['7'], hasMore: false, method: 'enumeration' }); await tick();
  if (boundary !== 'unmount') assert(!f.render().some(node => node.props.title === 'Token ID 7'));
  assert.deepEqual(f.checks, []); assert.deepEqual(f.saves, []);
  if (boundary !== 'unmount') f.close();
});

test('failed enumeration permits retry and never blocks a manual ownership check', async () => {
  let attempts = 0;
  const f = fixture({ enumerate: async () => {
    if (++attempts === 1) throw Error('Network unavailable');
    return { tokenIds: ['0'], hasMore: false, method: 'enumeration' };
  } });
  try {
    manual(f); button(f.render(), 'Find token IDs').props.onPress(); await tick();
    assert(f.render().some(node => node.type === 'Notice' && node.props.title === 'Token IDs unavailable'));
    button(f.render(), 'Find token IDs').props.onPress(); await tick();
    assert(button(f.render(), 'Token ID 0'));
    input(f.render(), 'Token ID').props.onChangeText('7');
    button(f.render(), 'Check ownership').props.onPress(); await tick();
    assert.deepEqual(f.checks, [{ contractAddress, tokenStandard: 'ERC-721', tokenId: '7' }]);
  } finally { f.close(); }
});

for (const totalOwned of ['0', maximumId, undefined]) test(`collection balance preserves ${totalOwned ?? 'unavailable'} without another lookup`, async () => {
  const f = fixture({ enumerate: async () => ({ tokenIds: totalOwned === '0' ? [] : ['0'], hasMore: totalOwned === maximumId, method: 'enumeration', totalOwned }) });
  try {
    manual(f); button(f.render(), 'Find token IDs').props.onPress(); await tick();
    const balance = f.render().find(node => node.props.testID === 'native-collection-balance');
    if (totalOwned === undefined) assert.equal(balance, undefined);
    else { assert(balance); assert.equal(balance.props.accessibilityLabel, `Collection balance: ${totalOwned} NFTs`); }
    assert.equal(f.enumerations.length, 1); assert.deepEqual(f.checks, []);
  } finally { f.close(); }
});

test('private collection balance masks the count in visible and accessible text', async () => {
  const f = fixture({ hidden: true, enumerate: async () => ({ tokenIds: [], hasMore: false, method: 'manual', totalOwned: maximumId }) });
  try {
    manual(f); button(f.render(), 'Find token IDs').props.onPress(); await tick();
    const balance = f.render().find(node => node.props.testID === 'native-collection-balance'); assert(balance);
    assert.equal(balance.props.accessibilityLabel, 'Collection balance hidden');
    assert.equal(JSON.stringify(balance).includes(maximumId), false);
    assert(balance.children.includes('Hidden'));
  } finally { f.close(); }
});

test('choosing two IDs retains one listing and its count while each ownership check stays bound', async () => {
  const first = deferred<{ tokenId: string; units: string }>();
  const f = fixture({
    enumerate: async () => ({ tokenIds: ['0', maximumId], totalOwned: '12', hasMore: true, method: 'enumeration' }),
    check: async query => (query as { tokenId: string }).tokenId === '0' ? first.promise : { tokenId: maximumId, units: '0' },
  });
  try {
    manual(f); button(f.render(), 'Find token IDs').props.onPress(); await tick();
    const oldLarge = button(f.render(), `Token ID ${maximumId}`);
    button(f.render(), 'Token ID 0').props.onPress();
    assert(button(f.render(), `Token ID ${maximumId}`).props.disabled);
    assert(f.render().some(node => node.props.testID === 'native-collection-balance'));
    oldLarge.props.onPress();
    assert.equal(input(f.render(), 'Token ID').props.value, '0'); assert.equal(f.checks.length, 1);
    first.resolve({ tokenId: '0', units: '1' }); await tick();
    assert.equal(button(f.render(), 'Token ID 0').props.icon, 'check');
    button(f.render(), `Token ID ${maximumId}`).props.onPress(); await tick();
    assert.equal(f.enumerations.length, 1);
    assert.deepEqual(f.checks, [
      { contractAddress, tokenStandard: 'ERC-721', tokenId: '0' },
      { contractAddress, tokenStandard: 'ERC-721', tokenId: maximumId },
    ]);
    assert.equal(button(f.render(), `Token ID ${maximumId}`).props.icon, 'check');
    assert(f.render().some(node => node.props.testID === 'native-collection-balance'));
    assert.deepEqual(f.saves, []);
    input(f.render(), 'Token ID').props.onChangeText('5');
    assert(!f.render().some(node => node.props.testID === 'native-collection-balance'));
  } finally { first.resolve({ tokenId: '0', units: '1' }); f.close(); }
});
