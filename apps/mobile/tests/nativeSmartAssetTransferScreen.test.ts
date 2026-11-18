import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface } from 'ethers/abi';
import { decodeAssetTransfer } from '../../../source/shared/assetTransfer.ts';
import { resolveAssetTransferDisplay } from '../../../source/shared/assetTransferDisplay.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { getNativeNetwork, getNativeSendContext } from '../src/custody/networkContext.ts';
import type { NativeSmartAccountOperationSnapshot } from '../src/smartAccount/operation.ts';
import { nativeTranslationFixture, englishI18n } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

const contract = '0x1111111111111111111111111111111111111111';
const owner = '0x2222222222222222222222222222222222222222';
const recipient = '0x3333333333333333333333333333333333333333';
const encode = (signature: string, args: unknown[]) => new Interface([`function ${signature}`]).encodeFunctionData(signature.split('(')[0]!, args);
function fixture() {
  const calls: unknown[][] = [];
  const screen = screenFixture(new URL('../src/screens/NativeSmartAccountOperation.tsx', import.meta.url), 'NativeSmartAccountOperationContent', {
    'react-native': { StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 }, View: 'View', Switch: 'Switch', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Coin', 'Header', 'Icon', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    '../../../../source/shared/assetTransferDisplay': { resolveAssetTransferDisplay },
    '../../../../source/shared/erc20': { formatTokenUnits }, '../core/amounts': { formatBaseUnits }, '../custody/networkContext': { getNativeSendContext },
    '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../platform/localization': nativeTranslationFixture, './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' }, './guardianPolicyLabels': { guardianDelayLabel: () => '' },
    './useDappLedgerConnection': { useOwnedLedgerConnection: () => ({}) },
  });
  const state = (intent: NativeSmartAccountOperationSnapshot['intent']): NativeSmartAccountOperationSnapshot => ({
    intent, phase: 'authorize', revision: 7, account: owner, network: getNativeNetwork('ethereum'), maximumPrefundUnits: '1000', userOperationHash: null,
    authorization: null, payerReview: null, transactionHash: null, userOperationSubmissionStarted: false, error: null,
  });
  const render = (snapshot: NativeSmartAccountOperationSnapshot, props: Record<string, unknown> = {}) => screenElements(screen.render({
    state: snapshot, onBack: () => calls.push(['back']), authorize: (risk: boolean) => calls.push(['authorize', risk]),
    confirmPayer: (id: number) => calls.push(['payer', id]), ...props,
  }));
  return { state, render, calls, close: screen.close };
}

test('Smart instruction cancellation reviews a no-op reference and both fees without claiming cancellation from outer completion', () => {
  const f = fixture(), reference = '0x' + '77'.repeat(32);
  try {
    const snapshot = f.state({ kind: 'cancel-operation', reference: { originalHash: reference } });
    const initial = f.render(snapshot), copy = text(initial);
    assert(copy.includes(reference));
    assert(initial.some(node => node.type === 'Notice' && node.props.body === englishI18n.t('transactions.smartAccountCancelDescription')));
    assert(!copy.includes(englishI18n.t('mobile.recoveryStatusViews.operation.smartAccountDeployed')));
    assert.deepEqual(f.calls, []);
    initial.find(node => node.type === 'Button' && node.props.title === englishI18n.t('transactions.smartAuthorizations.cancelInstruction'))!.props.onPress();
    const payer = f.render({ ...snapshot, phase: 'review-fee', payerReview: { id: 8, purpose: 'submit-operation',
      transaction: { from: owner, value: '0' } as never, maximumFeeUnits: '1000000000000000000', coveredFeeUnits: '0', maximumTotalUnits: '1000000000000000000' } });
    assert(text(payer).includes(owner)); assert(payer.some(node => node.type === 'Notice' && node.props.body === englishI18n.t('transactions.smartAccountAuthorizationRetained')));
    payer.find(node => node.type === 'Button' && node.props.title === englishI18n.t('mobile.recoveryStatusViews.operation.confirmTransaction'))!.props.onPress();
    assert.deepEqual(f.calls, [['authorize', false], ['payer', 8]]);
    const complete = f.render({ ...snapshot, phase: 'complete', transactionHash: '0x' + '88'.repeat(32) });
    assert(complete.some(node => node.type === 'Notice' && node.props.title === englishI18n.t('privacy.deposit.submitted')));
    assert(!complete.some(node => node.type === 'Notice' && node.props.title === englishI18n.t('mobile.recoveryStatusViews.operation.smartAccountDeployed')));
  } finally { f.close(); }
});
const text = (nodes: ReturnType<ReturnType<typeof fixture>['render']>) => nodes.flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ');
const payerBudget = { address: owner, gasTank: false, maximumFeeWei: '2000', maximumPrefundFeeWei: '0', maximumPrefundWei: '0' };

test('Smart Send shows the EntryPoint and payer limits before one confirmation', () => {
  const f = fixture();
  try {
    const state = { ...f.state({ kind: 'native-transfer', recipient, amountUnits: '5' }), payerBudget };
    const nodes = f.render(state), copy = text(nodes);
    assert(copy.includes(englishI18n.t('send.smartAccountMaxFee')));
    assert(copy.includes(englishI18n.t('transactions.replay.maximumFee')));
    assert(copy.includes(formatBaseUnits(state.maximumPrefundUnits!, state.network.decimals)));
    assert(copy.includes(formatBaseUnits(payerBudget.maximumFeeWei, state.network.decimals)));
    assert(copy.includes(payerBudget.address));
    nodes.find(node => node.type === 'Button' && node.props.title === 'Confirm transfer')!.props.onPress();
    assert.deepEqual(f.calls, [['authorize', false]]);
    assert(!f.render({ ...state, phase: 'preparing-fee' }).some(node => node.type === 'Button' && node.props.title === 'Confirm transfer'));
  } finally { f.close(); }
});

test('unsigned Smart collectible shortfall shows localized amount feedback instead of transfer status', () => {
  const f = fixture();
  try {
    const state = { ...f.state({ kind: 'nft-transfer', chainId: '1', from: owner, contractAddress: contract,
      recipient, tokenStandard: 'ERC-1155', tokenId: '3', amountUnits: '11' }), phase: 'failed' as const,
    error: 'This operation could not be prepared. Return to your account and try again.', preparationFailure: 'INSUFFICIENT_ASSET' as const };
    const notices = f.render(state).filter(node => node.type === 'Notice');
    assert(notices.some(node => node.props.title === 'Insufficient funds' && node.props.body === 'Not enough tokens for this transfer.'));
    assert(!notices.some(node => node.props.title === 'Check transfer status'));
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

for (const submission of [false, true]) test(`Smart asset feedback does not relabel ${submission ? 'a submission' : 'an untyped error'} as an unsigned amount failure`, () => {
  const f = fixture();
  try {
    const state = { ...f.state({ kind: 'nft-transfer', chainId: '1', from: owner, contractAddress: contract,
      recipient, tokenStandard: 'ERC-1155', tokenId: '3', amountUnits: '11' }), phase: 'failed' as const,
    error: 'Insufficient token or collectible balance', ...(submission ? {
      preparationFailure: 'INSUFFICIENT_ASSET' as const, transactionHash: '0x' + 'ab'.repeat(32), userOperationSubmissionStarted: true,
    } : {}) };
    const notices = f.render(state).filter(node => node.type === 'Notice');
    assert(notices.some(node => node.props.title === 'Check transfer status' && node.props.body === state.error));
    assert(!notices.some(node => node.props.title === 'Insufficient funds'));
  } finally { f.close(); }
});

test('Smart dapp token review shows exact token amount and recipient with native value separately', () => {
  const f = fixture();
  try {
    const units = (2n ** 255n).toString(), data = encode('transfer(address,uint256)', [recipient, units]);
    const transfer = decodeAssetTransfer(data, contract, { standard: 'ERC-20', token: { contractAddress: contract, name: 'Exact token', symbol: 'TOK', decimals: 255 } });
    const snapshot = { ...f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '1000000000000000001', data }), payerBudget };
    const nodes = f.render(snapshot, { assetTransfer: transfer }), copy = text(nodes);
    assert(copy.includes(formatTokenUnits(units, 255))); assert(copy.includes(recipient)); assert(copy.includes(contract));
    assert(copy.includes('Also sending')); assert(copy.includes('1.000000000000000001')); assert(copy.includes('Token metadata is supplied by the contract.'));
    assert(nodes.some(node => node.type === 'Coin' && node.props.asset.chainId === snapshot.network.chainId && node.props.asset.contractAddress === contract && node.props.registrationHash === snapshot.network.registrationHash));
    assert(copy.includes(englishI18n.t('transactions.replay.maximumFee')));
    nodes.find(node => node.type === 'Button' && node.props.title === 'Confirm transaction')!.props.onPress();
    assert.deepEqual(f.calls, [['authorize', false]]);
  } finally { f.close(); }
});

test('Smart mixed batch shows ordered NFT IDs/quantities, raw unknown units and native call', () => {
  const f = fixture();
  try {
    const id = (2n ** 256n - 1n).toString();
    const calls = [
      { to: contract, value: '0x0', data: encode('safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)', [owner, recipient, [0, id], [2, 3], '0x']) },
      { to: contract, value: '0x0', data: encode('transferFrom(address,address,uint256)', [owner, recipient, 91]) },
      { to: recipient, value: '0x1', data: '0x' },
    ];
    const nodes = f.render({ ...f.state({ kind: 'dapp-batch', calls }), payerBudget }), copy = text(nodes);
    assert(copy.includes('#0')); assert(copy.includes(`#${id}`)); assert(copy.includes('2 NFTs')); assert(copy.includes('3 NFTs'));
    assert(copy.includes('91')); assert(copy.includes('Base units / token ID')); assert(copy.includes('Token standard unverified'));
    assert(nodes.some(node => node.children.join('') === 'Call 1 of 3'));
    assert(nodes.some(node => node.children.join('') === 'Call 3 of 3')); assert(copy.includes('Native currency sent'));
    const details = nodes.filter(node => node.type === 'TransactionDetails');
    assert.deepEqual(details.map(node => node.props.transaction.data), calls.map(call => call.data));
    assert(copy.includes(englishI18n.t('transactions.replay.maximumFee')));
    nodes.find(node => node.type === 'Button' && node.props.title === 'Confirm calls')!.props.onPress();
    assert.deepEqual(f.calls, [['authorize', false]]);
  } finally { f.close(); }
});

test('Smart review discards stale token enrichment when exact calldata changes', () => {
  const f = fixture();
  try {
    const data = encode('transfer(address,uint256)', [recipient, 123]);
    const old = decodeAssetTransfer(data, contract, { standard: 'ERC-20', token: { contractAddress: contract, name: 'Old token', symbol: 'OLD', decimals: 6 } });
    const snapshot = f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '0', data: encode('transfer(address,uint256)', [owner, 456]) });
    const copy = text(f.render(snapshot, { assetTransfer: old }));
    assert(copy.includes('456')); assert(copy.includes(owner)); assert(!copy.includes('OLD')); assert(!copy.includes('0.000123'));
    assert(copy.includes('Token standard unverified'));
  } finally { f.close(); }
});

test('Smart ERC721 transferFrom uses verified token ID instead of treating it as a fungible amount', () => {
  const f = fixture();
  try {
    const id = (2n ** 255n).toString();
    const data = encode('transferFrom(address,address,uint256)', [owner, recipient, id]);
    const assetTransfer = decodeAssetTransfer(data, contract, { standard: 'ERC-721' });
    const nodes = f.render(f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '0', data }), { assetTransfer });
    const copy = text(nodes);
    assert(copy.includes(`#${id}`)); assert(copy.includes('1 NFT')); assert(copy.includes(owner)); assert(copy.includes(recipient));
    assert(!copy.includes('Base units / token ID')); assert(!copy.includes('Token standard unverified'));
  } finally { f.close(); }
});

for (const units of ['1', '2', ((1n << 256n) - 1n).toString()]) test(`Smart NFT quantity preserves ${units} with the matching noun`, () => {
  const f = fixture();
  try {
    const data = encode('safeTransferFrom(address,address,uint256,uint256,bytes)', [owner, recipient, 3, units, '0x']);
    const assetTransfer = decodeAssetTransfer(data, contract, { standard: 'ERC-1155' });
    const nodes = f.render(f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '0', data }), { assetTransfer });
    const expected = `${units} ${units === '1' ? 'NFT' : 'NFTs'}`;
    assert(nodes.some(node => node.type === 'Text' && node.children.join('') === expected));
    assert(nodes.some(node => node.type === 'Text' && node.props.accessibilityLabel === `Token ID 3, quantity ${units}`));
    assert(!nodes.some(node => node.type === 'Text' && node.children.join('') === '1 NFTs'));
    assert.deepEqual(f.calls, []);
  } finally { f.close(); }
});

test('unknown Smart contract calls retain explicit native-only value and raw transaction details', () => {
  const f = fixture();
  try {
    const snapshot = f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '0', data: '0x12345678' });
    const nodes = f.render(snapshot), copy = text(nodes);
    assert(copy.includes('Contract')); assert(copy.includes('Native currency sent')); assert(copy.includes('This amount excludes any tokens or NFTs the contract may move.'));
    assert(!copy.includes('Recipient')); assert(nodes.some(node => node.type === 'TransactionDetails' && node.props.transaction.data === '0x12345678'));
  } finally { f.close(); }
});
