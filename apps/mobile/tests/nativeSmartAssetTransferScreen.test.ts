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
import { nativeTranslationFixture } from './localizationFixture.ts';
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
const text = (nodes: ReturnType<ReturnType<typeof fixture>['render']>) => nodes.flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ');

test('Smart dapp token review shows exact token amount and recipient with native value separately', () => {
  const f = fixture();
  try {
    const units = (2n ** 255n).toString(), data = encode('transfer(address,uint256)', [recipient, units]);
    const transfer = decodeAssetTransfer(data, contract, { standard: 'ERC-20', token: { contractAddress: contract, name: 'Exact token', symbol: 'TOK', decimals: 255 } });
    const snapshot = f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '1000000000000000001', data });
    const nodes = f.render(snapshot, { assetTransfer: transfer }), copy = text(nodes);
    assert(copy.includes(formatTokenUnits(units, 255))); assert(copy.includes(recipient)); assert(copy.includes(contract));
    assert(copy.includes('Also sending')); assert(copy.includes('1.000000000000000001')); assert(copy.includes('Token metadata is supplied by the contract.'));
    assert(nodes.some(node => node.type === 'Coin' && node.props.asset.chainId === snapshot.network.chainId && node.props.asset.contractAddress === contract && node.props.registrationHash === snapshot.network.registrationHash));
    nodes.find(node => node.type === 'Button' && node.props.title === 'Authorize transaction')!.props.onPress();
    const fee = f.render({ ...snapshot, phase: 'review-fee', payerReview: { id: 8, purpose: 'submit-operation', transaction: { from: owner, value: '0' } as never, maximumFeeUnits: '1', coveredFeeUnits: '0', maximumTotalUnits: '1' } }, { assetTransfer: transfer });
    fee.find(node => node.type === 'Button' && node.props.title === 'Confirm transaction')!.props.onPress();
    assert.deepEqual(f.calls, [['authorize', false], ['payer', 8]]);
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
    const nodes = f.render(f.state({ kind: 'dapp-batch', calls })), copy = text(nodes);
    assert(copy.includes('#0')); assert(copy.includes(`#${id}`)); assert(copy.includes('2 NFTs')); assert(copy.includes('3 NFTs'));
    assert(copy.includes('91')); assert(copy.includes('Base units / token ID')); assert(copy.includes('Token standard unverified'));
    assert(nodes.some(node => node.children.join('') === 'Call 1 of 3'));
    assert(nodes.some(node => node.children.join('') === 'Call 3 of 3')); assert(copy.includes('Native currency sent'));
    const details = nodes.filter(node => node.type === 'TransactionDetails');
    assert.deepEqual(details.map(node => node.props.transaction.data), calls.map(call => call.data));
    nodes.find(node => node.type === 'Button' && node.props.title === 'Authorize calls')!.props.onPress();
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

test('unknown Smart contract calls retain explicit native-only value and raw transaction details', () => {
  const f = fixture();
  try {
    const snapshot = f.state({ kind: 'dapp-call', recipient: contract, amountUnits: '0', data: '0x12345678' });
    const nodes = f.render(snapshot), copy = text(nodes);
    assert(copy.includes('Contract')); assert(copy.includes('Native currency sent')); assert(copy.includes('This amount excludes any tokens or NFTs the contract may move.'));
    assert(!copy.includes('Recipient')); assert(nodes.some(node => node.type === 'TransactionDetails' && node.props.transaction.data === '0x12345678'));
  } finally { f.close(); }
});
