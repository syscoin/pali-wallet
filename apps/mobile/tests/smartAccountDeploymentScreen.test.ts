import { resolveAssetTransferDisplay } from '../../../source/shared/assetTransferDisplay.ts';
import { formatTokenUnits } from '../../../source/shared/erc20.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { guardianDelayLabel } from '../src/screens/guardianPolicyLabels.ts';
import {
  getNativeNetwork,
  getNativeSendContext,
} from '../src/custody/networkContext.ts';
import type { NativeSmartAccountOperationSnapshot } from '../src/smartAccount/operation.ts';
import { nativeTranslationFixture } from './localizationFixture.ts';

type Element = {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
};
function fixture() {
  let expanded = false;
  let state: NativeSmartAccountOperationSnapshot = {
    intent: { kind: 'deploy' },
    phase: 'authorize',
    revision: 4,
    account: '0x1111111111111111111111111111111111111111',
    network: getNativeNetwork('ethereum'),
    maximumPrefundUnits: '3000000000000000',
    userOperationHash: '0x' + 'ab'.repeat(32),
    authorization: {
      entryPoint: '0x2222222222222222222222222222222222222222',
      nonce: '7',
      initCode: '0xab',
      callData: '0xcd',
    },
    payerReview: null,
    transactionHash: null,
    userOperationSubmissionStarted: false,
    error: null,
  };
  const calls = {
    authorize: [] as number[],
    confirm: [] as number[],
    close: 0,
  };
  const react = {
    createElement(
      type: unknown,
      props: Record<string, unknown> | null,
      ...children: unknown[]
    ): Element {
      if (typeof type === 'function') return type({ ...props, children });
      return { type, props: props ?? {}, children };
    },
    useState() {
      return [
        expanded,
        (value: boolean) => {
          expanded = value;
        },
      ];
    },
    useEffect() {},
    useRef(initial: unknown) { return { current: initial }; },
    useLayoutEffect(run: () => unknown) { run(); },
    useCallback<T>(callback: T) {return callback;},
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) {
      return read();
    },
  };
  const source = readFileSync(
    new NodeURL('../src/screens/NativeSmartAccountOperation.tsx', import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const imports: Record<string, unknown> = {
    react,
    '../platform/localization': nativeTranslationFixture,
    './useDappLedgerConnection': {useOwnedLedgerConnection: () => ({blocked: false, showConnect: false, modal: null, canApprove: () => true})},
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      Platform: { OS: 'ios' },
      View: 'View',
      StyleSheet: { create: (styles: unknown) => styles },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': {
      colors: {},
      ...Object.fromEntries(
        ['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map((name) => [
          name,
          name,
        ])
      ),
    },
    './NativeTransactionReview': { TransactionDetails: () => null },
    '../core/amounts': { formatBaseUnits },
    '../../../../source/shared/assetTransferDisplay': { resolveAssetTransferDisplay },
    '../../../../source/shared/erc20': { formatTokenUnits },
    '../custody/networkContext': { getNativeSendContext },
    './guardianPolicyLabels': { guardianDelayLabel },
  };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name: string) {
      assert(Object.hasOwn(imports, name), name);
      return imports[name];
    },
  });
  const render = () =>
    (
      module.exports.NativeSmartAccountOperationScreen as (
        props: object
      ) => Element
    )({
      controller: {
        getSnapshot: () => state,
        subscribe: () => () => {},
        authorize: (revision: number) => {
          calls.authorize.push(revision);
        },
        confirmPayer: (id: number) => {
          calls.confirm.push(id);
        },
      },
      onBack: () => {
        calls.close++;
      },
    });
  return {
    render,
    calls,
    update(change: Partial<NativeSmartAccountOperationSnapshot>) {
      state = { ...state, ...change };
    },
  };
}
function all(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(all);
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const node = value as Element;
  return [node, ...node.children.flatMap(all), ...all(node.props.footer)];
}
function button(tree: Element, title: string) {
  const found = all(tree).find(
    (node) => node.type === 'Button' && node.props.title === title
  );
  assert(found, `Missing button ${title}`);
  return found.props.onPress as () => void;
}
const text = (tree: Element) =>
  all(tree)
    .flatMap((node) =>
      node.children.filter((child) => typeof child === 'string')
    )
    .join(' ');

test('deployment screen separates exact account authorization from payer confirmation', () => {
  const f = fixture();
  let tree = f.render();
  assert.match(text(tree), /0.003 ETH/);
  assert.equal(
    all(tree).some((node) => node.props.title === 'Confirm deployment'),
    false
  );
  button(tree, 'View authorization details')();
  tree = f.render();
  assert.match(text(tree), /0xab/);
  assert.match(text(tree), /0xcd/);
  button(tree, 'Authorize deployment')();
  assert.deepEqual(f.calls.authorize, [4]);
  f.update({
    phase: 'review-fee',
    payerReview: {
      id: 8,
      purpose: 'submit-operation',
      coveredFeeUnits: '0', maximumFeeUnits: '42000',
      maximumTotalUnits: '42000',
      transaction: {
        chainId: '1',
        from: '0x3333333333333333333333333333333333333333',
        to: '0x2222222222222222222222222222222222222222',
        nonce: '0',
        value: '0',
        data: '0xab',
        gasLimit: '21000',
        type: 2,
        maxFeePerGas: '2',
        maxPriorityFeePerGas: '1',
        accessList: [],
      },
    },
  });
  tree = f.render();
  assert.match(text(tree), /0x3333333333333333333333333333333333333333/);
  assert.equal(
    all(tree).some((node) => node.props.title === 'Authorize deployment'),
    false
  );
  button(tree, 'Confirm deployment')();
  assert.deepEqual(f.calls.confirm, [8]);
  button(tree, 'Close')();
  assert.equal(f.calls.close, 1);
});

test('waiting and failed deployment screens expose no stale signing button', () => {
  const f = fixture();
  const hash = '0x' + 'fe'.repeat(32);
  for (const phase of ['waiting', 'failed', 'complete'] as const) {
    f.update({
      phase,
      payerReview: null,
      transactionHash: hash,
      error:
        phase === 'failed'
          ? 'Check the account and Activity before starting again.'
          : null,
    });
    const tree = f.render();
    assert.equal(all(tree).filter((node) => node.type === 'Button').length, 1);
    assert.match(text(tree), new RegExp(hash));
    button(tree, 'Close')();
  }
  assert.equal(f.calls.close, 3);
});


test('native Smart transfer review binds the recipient and exact amount to authorization', () => {
  const f = fixture();
  const recipient = '0x4444444444444444444444444444444444444444';
  f.update({ intent: { kind: 'native-transfer', recipient, amountUnits: '9' } });
  const tree = f.render();
  assert.match(text(tree), new RegExp(recipient));
  assert.match(text(tree), /0.000000000000000009 ETH/);
  assert.doesNotMatch(text(tree), /This operation sends no assets/);
  button(tree, 'Authorize transfer')();
  assert.deepEqual(f.calls.authorize, [4]);
});


test('Smart token authorization shows exact 255-decimal units and the contract', () => {
  const f = fixture();
  const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 255, name: 'Exact token', symbol: 'EXACT' };
  f.update({ intent: { kind: 'erc20-transfer', token, recipient: '0x2222222222222222222222222222222222222222', amountUnits: '9' } });
  const tree = f.render();
  assert(text(tree).includes(token.contractAddress));
  assert(text(tree).includes('0.' + '0'.repeat(254) + '9'));
  button(tree, 'Authorize transfer')();
  assert.deepEqual(f.calls.authorize, [4]);
});


test('Smart NFT authorization shows contract, token ID and exact quantity', () => {
  const f = fixture();
  const contractAddress = '0x6666666666666666666666666666666666666666';
  f.update({ intent: { kind: 'nft-transfer', chainId: '1', from: '0x1111111111111111111111111111111111111111', contractAddress,
    recipient: '0x2222222222222222222222222222222222222222', tokenStandard: 'ERC-1155', tokenId: '7', amountUnits: '9007199254740993' } });
  const tree = f.render();
  assert(text(tree).includes(contractAddress));
  assert(text(tree).includes('9007199254740993'));
  assert(text(tree).includes('ERC-1155'));
  button(tree, 'Authorize transfer')();
  assert.deepEqual(f.calls.authorize, [4]);
});


test('approval change separates the current method from proposed owners and keeps contract data in details', () => {
  const f = fixture();
  const validator = '0x5555555555555555555555555555555555555555';
  const owners = ['0x6666666666666666666666666666666666666666', '0x7777777777777777777777777777777777777777'];
  f.update({ intent: { kind: 'authenticator', command: {
    accountAddress: '0x1111111111111111111111111111111111111111', chainId: 1, executions: [],
    sourceAuthHash: '0x' + '88'.repeat(32), sourceModule: 'slh-dsa',
    target: { module: 'ecdsa', validator, data: '0x1234' },
    targetModule: { type: 'validator', id: 'ecdsa', address: validator, data: '0x1234', config: { owners, threshold: 1 } },
  } } });
  let tree = f.render();
  assert.equal(all(tree).find(node => node.type === 'Header')!.props.title, 'Change approval method');
  assert.match(text(tree), /Current approval method.*Post-quantum key.*New approval method.*Wallet owners/);
  assert.match(text(tree), /1 of 2 owners can approve/);
  assert(text(tree).includes(owners[0]!)); assert.doesNotMatch(text(tree), new RegExp(validator));
  button(tree, 'View approval details')(); tree = f.render(); assert.match(text(tree), new RegExp(validator));
  button(tree, 'Authorize approval change')(); assert.deepEqual(f.calls.authorize, [4]);
});
