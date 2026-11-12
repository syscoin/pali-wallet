import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { getNativeNetwork, getNativeSendContext } from '../src/custody/networkContext.ts';
import type { NativeSmartAccountOperationSnapshot } from '../src/smartAccount/operation.ts';

const hash = `0x${'ab'.repeat(32)}`;
const state: NativeSmartAccountOperationSnapshot = { phase: 'complete', revision: 1,
  account: `0x${'11'.repeat(20)}`, network: getNativeNetwork('ethereum'),
  intent: { kind: 'native-transfer', recipient: `0x${'22'.repeat(20)}`, amountUnits: '1' },
  transactionHash: hash, userOperationHash: `0x${'cd'.repeat(32)}`, userOperationSubmissionStarted: true,
  maximumPrefundUnits: '1', authorization: null, payerReview: null, error: null };
function fixture() {
  return screenFixture(new URL('../src/screens/NativeSmartAccountOperation.tsx', import.meta.url), 'NativeSmartAccountOperationContent', {
    'react-native': { StyleSheet: { create: (x: unknown) => x }, View: 'View', Switch: 'Switch', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../platform/localization': nativeTranslationFixture,
    '../ui': { colors: {}, Button: 'Button', Card: 'Card', Coin: 'Coin', Header: 'Header', Notice: 'Notice', Screen: 'Screen', Text: 'Text' },
    '../../../../source/shared/assetTransferDisplay': { resolveAssetTransferDisplay: () => null },
    '../../../../source/shared/erc20': { formatTokenUnits: () => '' }, '../core/amounts': { formatBaseUnits },
    '../custody/networkContext': { getNativeSendContext }, './NativeTransactionReview': { TransactionDetails: 'Details' },
    './guardianPolicyLabels': { guardianDelayLabel: () => '' }, '../custody/privateAuthentication': {},
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption: () => false }, './useDappLedgerConnection': {},
  });
}

test('Smart completion exposes bound local transaction navigation and retires its callback on Done', () => {
  const f = fixture(), viewed: string[] = []; let closed = 0;
  try {
    const render = (value = state) => screenElements(f.render({ state: value, onBack: () => { closed++; },
      authorize() {}, confirmPayer() {}, onViewTransaction: (value: string) => viewed.push(value) }));
    const initial = render(), view = initial.find(node => node.props.title === 'View transaction'); assert(view);
    view.props.onPress(); assert.deepEqual(viewed, [hash]);
    render({ ...state, transactionHash: `0x${'ef'.repeat(32)}` });
    view.props.onPress(); assert.deepEqual(viewed, [hash], 'old transaction callback cannot target a newer result');
    const current = render();
    current.find(node => node.props.title === 'Done')!.props.onPress();
    current.find(node => node.props.title === 'View transaction')!.props.onPress();
    assert.equal(closed, 1); assert.deepEqual(viewed, [hash]);
  } finally { f.close(); }
});

test('a funding-only wait does not offer navigation as a completed Smart transfer', () => {
  const f = fixture();
  try {
    const nodes = screenElements(f.render({ state: { ...state, phase: 'waiting', userOperationSubmissionStarted: false },
      onBack() {}, authorize() {}, confirmPayer() {}, onViewTransaction() {} }));
    assert(!nodes.some(node => node.props.title === 'View transaction'));
  } finally { f.close(); }
});
