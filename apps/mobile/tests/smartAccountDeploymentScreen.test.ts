import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { formatBaseUnits } from '../src/core/amounts.ts';
import {
  getNativeNetwork,
  getNativeSendContext,
} from '../src/custody/networkContext.ts';
import type { NativeSmartAccountDeploymentSnapshot } from '../src/smartAccount/deployment.ts';

type Element = {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
};
function fixture() {
  let expanded = false;
  let state: NativeSmartAccountDeploymentSnapshot = {
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
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) {
      return read();
    },
  };
  const source = readFileSync(
    new NodeURL('../src/screens/NativeSmartAccountDeployment.tsx', import.meta.url),
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
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
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
    '../core/amounts': { formatBaseUnits },
    '../custody/networkContext': { getNativeSendContext },
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
      module.exports.NativeSmartAccountDeploymentScreen as (
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
    update(change: Partial<NativeSmartAccountDeploymentSnapshot>) {
      state = { ...state, ...change };
    },
  };
}
function all(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(all);
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  const node = value as Element;
  return [node, ...node.children.flatMap(all)];
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
      purpose: 'submit-deployment',
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
