import assert from 'node:assert/strict';
import test from 'node:test';
import { sendDraftForNetwork, type NativeUnsignedSendDraft } from '../src/screens/sendNetworkDraft.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import { getUtxoNetwork } from '../src/core/utxoNetworks.ts';
import type { NativeNetworkSnapshot, NativeNetworkView } from '../src/custody/networkView.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { networkSelectionReceiptFixture } from './networkSelectionReceiptFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { UTXO_ADDRESSES } from './publicWatchFixtures.ts';

const EVM_ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const evmDraft: NativeUnsignedSendDraft = { kind: 'evm', recipient: EVM_ADDRESS, amount: '1.2', nonce: '7', tokenId: '9', max: true, advanced: true };

test('actual network changes preserve only a validated compatible recipient and reset network-scoped form values', () => {
  assert.deepEqual(sendDraftForNetwork(evmDraft, getNativeNetwork('syscoin-nevm')), {
    kind: 'evm', recipient: EVM_ADDRESS, amount: '', nonce: '', max: false, advanced: false,
  });
  assert.equal(sendDraftForNetwork({ ...evmDraft, recipient: 'alice.eth' }, getNativeNetwork('syscoin-nevm')).recipient, '');
  assert.equal(sendDraftForNetwork(evmDraft, getUtxoNetwork('bitcoin')).recipient, '');
  const bitcoin: NativeUnsignedSendDraft = { kind: 'utxo', recipient: UTXO_ADDRESSES.bitcoin, amount: '0.4', max: true, rbf: false };
  assert.equal(sendDraftForNetwork(bitcoin, getUtxoNetwork('bitcoin')).recipient, bitcoin.recipient);
  assert.equal(sendDraftForNetwork(bitcoin, getUtxoNetwork('syscoin')).recipient, '');
  assert.equal(sendDraftForNetwork(bitcoin, getNativeNetwork('ethereum')).recipient, '');
});

function picker() {
  const targets = [getNativeNetwork('ethereum'), getNativeNetwork('syscoin-nevm')];
  let contextRevision = 3, live = true, cancellations = 0;
  let snapshot: NativeNetworkSnapshot = { revision: 5, selectedId: 'ethereum', networks: targets.map(target => ({ ...target, registration: target, canSign: true })) };
  const requests: unknown[] = [], selected: string[] = [];
  let hold: Promise<void> | undefined;
  const controller: NativeNetworkView = {
    getSnapshot: () => snapshot, getContextRevision: () => contextRevision, subscribe: () => () => {},
    cancel() { cancellations++; },
    async select(id, expectedContext, expectedCatalogue, onCommitted) {
      requests.push([id, expectedContext, expectedCatalogue]); await hold;
      const target = targets.find(target => target.id === id)!;
      snapshot = { ...snapshot, selectedId: id, revision: expectedCatalogue + 1 }; contextRevision = expectedContext + 1;
      const receipt = networkSelectionReceiptFixture(target, { accountId: 'hd:60:0', address: EVM_ADDRESS, networkId: id }, expectedContext, expectedCatalogue, () => {
        if (!live) throw Error('stale');
      });
      onCommitted(receipt); return receipt;
    },
    save: async () => { throw Error('Selection screen cannot edit networks'); },
  };
  let back = () => false, closes = 0;
  const screen = screenFixture(new URL('../src/screens/NativeNetworks.tsx', import.meta.url), 'NativeNetworks', {
    '../platform/localization': nativeTranslationFixture,
    './IdleActivityBoundary': { IdleTextInput: 'Input', IdlePressable: 'Pressable' },
    'react-native': { Platform: { OS: 'android' }, View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', StyleSheet: { create: (value: unknown) => value }, Keyboard: { dismiss() {} },
      BackHandler: { addEventListener(_event: string, callback: () => boolean) { back = callback; return { remove() {} }; } } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../../../../source/shared/chainCatalogue': { rankChainSuggestions: () => [] },
    '../custody/networkContext': { createNativeNetwork: () => { throw Error('No network editing'); } },
    '../ui': { ...Object.fromEntries(['Button', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
  });
  const props = { controller, onBack() { closes++; }, selection: { purpose: 'send', assertCurrent() { if (!live) throw Error('stale'); }, onSelected(receipt: { selection: { networkId: string } }) { selected.push(receipt.selection.networkId); } } };
  const options = () => screenElements(screen.render(props)).filter(node => node.props.network);
  return { screen, props, options, requests, selected, back: () => back(), closes: () => closes, cancellations: () => cancellations,
    hold(value: Promise<void>) { hold = value; }, stale() { live = false; } };
}

test('selection-only picker preserves Back/Cancel and uses the captured shared selection revisions', async () => {
  const f = picker();
  try {
    const tree = f.screen.render(f.props);
    assert.equal(screenElements(tree).some(node => node.props.title === 'Add network'), false);
    const cancel = screenElements(tree).find(node => node.props.title === 'Cancel'); assert(cancel); cancel.props.onPress();
    assert.equal(f.closes(), 1); assert.deepEqual(f.requests, []);
    const target = f.options().find(node => node.props.network.id === 'syscoin-nevm'); assert(target);
    await target.props.onSelect('syscoin-nevm');
    assert.deepEqual(f.requests, [['syscoin-nevm', 3, 5]]); assert.deepEqual(f.selected, ['syscoin-nevm']);
    f.back(); assert.equal(f.closes(), 2);
  } finally { f.screen.close(); }
});

test('cancelled or unmounted picker cannot deliver a late selection or invoke a stale row callback', async () => {
  for (const end of ['cancel', 'unmount', 'scope'] as const) {
    const f = picker(), held = Promise.withResolvers<void>(); f.hold(held.promise);
    const row = f.options().find(node => node.props.network.id === 'syscoin-nevm'); assert(row);
    const selecting = row.props.onSelect('syscoin-nevm');
    if (end === 'cancel') f.back(); else if (end === 'scope') f.stale(); else f.screen.close();
    held.resolve(); await selecting; assert.deepEqual(f.selected, []);
    const before = f.requests.length;
    f.screen.close(); await row.props.onSelect('syscoin-nevm'); assert.equal(f.requests.length, before);
  }
});
