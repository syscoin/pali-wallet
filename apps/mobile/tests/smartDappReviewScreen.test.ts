import { nativeTranslationFixture } from './localizationFixture.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { getNativeNetwork } from '../src/custody/networkContext.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
function fixture() {
  let cursor = 0;
  const hooks: any[] = [];
  const calls: unknown[] = [];
  let current: any = {
    kind: 'smart-transaction', id: 'request-1', revision: 7, error: null,
    needsAccountSwitch: false, busy: false, dispatched: false,
    appName: 'Fixture app', origin: 'https://fixture.example', verification: { validation: 'UNKNOWN', isScam: false },
    chainId: '1',
    approval: { canEditAmount: true }, advisories: [], requiresWarningAcknowledgement: false,
    operation: { phase: 'authorize', network: getNativeNetwork('ethereum'), intent: { kind: 'dapp-call', recipient: '0x' + '11'.repeat(20), amountUnits: '0', data: '0x1234' } },
  };
  const controller = {
    isRequestAuthenticating: (id: string) => id === current.id,
    getSnapshot: () => ({ signingReview: current }),
    approveRequest: async (...args: unknown[]) => { calls.push(['approve', ...args]); },
    confirmSmartPayer: async (...args: unknown[]) => { calls.push(['payer', ...args]); },
    rejectRequest: async (...args: unknown[]) => { calls.push(['reject', ...args]); },
    editApprovalAmount: async (...args: unknown[]) => { calls.push(['edit', ...args]); },
  };
  const react = {
    createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useEffect() {},
    useMemo(create: () => unknown, deps: unknown[]) { const index = cursor++; if (!(index in hooks) || deps.some((value, i) => value !== hooks[index].deps[i])) hooks[index] = { value: create(), deps }; return hooks[index].value; },
    useState(initial: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value: unknown) => { hooks[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
  };
  const imports: Record<string, unknown> = {
    '../platform/localization': nativeTranslationFixture,
    './useDappLedgerConnection': {
      // This fixture reviews software-owner approval and allowance editing.
      useDappLedgerConnection: () => ({
        blocked: false, showConnect: false, modal: null,
        canApprove: () => true,
      }),
    },
    react, 'react-native': { StyleSheet: { create: (value: unknown) => value }, View: 'View', BackHandler: { addEventListener: () => ({ remove() {} }) } },
    './NativeSmartAccountOperation': { NativeSmartAccountOperationContent: 'Content' },
    './ApprovalReview': { ApprovalReview: 'Approval' }, './DappSiteStatus': { DappSiteStatus: 'Site' },
    './IdleActivityBoundary': { IdlePressable: 'Pressable' },
    '../ui': { Button: 'Button', Card: 'Card', Notice: 'Notice', Text: 'Text', colors: { muted: '#8899aa', blue: '#66ccff', bg: '#001122' } },
  };
  const module = { exports: {} as Record<string, any> };
  const source = readFileSync(new NodeURL('../src/screens/NativeSmartTransactionReview.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: (name: string) => { assert(name in imports, name); return imports[name]; } });
  return { calls, controller, current: () => current,
    replaceIntent() { current = { ...current, revision: current.revision + 1, operation: { ...current.operation, intent: { ...current.operation.intent, data: '0xabcd' } } }; },
    render(): Element { cursor = 0; return module.exports.NativeSmartTransactionReviewScreen({ review: current, controller }); },
  };
}
function nodes(value: any): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('children' in value)) return [];
  return [value, ...value.children.flatMap(nodes)];
}
function approval(tree: Element) { return nodes(tree.props.before).find(node => node.type === 'Approval')!; }

test('Smart dapp review routes public request and payer identifiers only', () => {
  const f = fixture(); const tree = f.render();
  tree.props.authorize(); tree.props.confirmPayer(12); tree.props.onBack();
  assert.deepEqual(f.calls, [['approve', 'request-1', 7, true], ['payer', 'request-1', 7, 12], ['reject', 'request-1']]);
  const view = nodes(tree.props.before);
  assert(view.some(node => node.children.includes('https://fixture.example')));
  assert.equal(approval(tree).props.chainId, '1');
  assert.equal(approval(tree).props.registrationHash, getNativeNetwork('ethereum').registrationHash);
});
test('dirty Smart allowance cannot authorize and a stale editor callback cannot clear the newer edit', () => {
  const f = fixture(); const first = f.render(); const old = approval(first);
  old.props.onEditingChange(true); f.render().props.authorize(); assert.equal(f.calls.length, 0);
  f.replaceIntent(); const next = f.render(); approval(next).props.onEditingChange(true);
  old.props.onEditingChange(false);
  f.render().props.authorize(); assert.equal(f.calls.length, 0);
  approval(f.render()).props.onEditingChange(false); f.render().props.authorize(); assert.equal(f.calls.length, 1);
});
test('Smart wrapper forwards only the current public transfer summaries without adding consent actions', () => {
  const f = fixture();
  const single = { contract: 'first' }, batch = [single, null];
  Object.assign(f.current(), { assetTransfer: single, batchAssetTransfers: batch });
  const tree = f.render();
  assert.equal(tree.props.assetTransfer, single);
  assert.equal(tree.props.batchAssetTransfers, batch);
  assert.deepEqual(f.calls, []);
  f.replaceIntent();
  Object.assign(f.current(), { assetTransfer: null, batchAssetTransfers: undefined });
  const next = f.render();
  assert.equal(next.props.assetTransfer, null);
  assert.equal(next.props.batchAssetTransfers, undefined);
  assert.deepEqual(f.calls, []);
});

test('Smart dapp operation receives a stable request-only authentication status adapter', () => {
  const f = fixture(), first = f.render().props.authentication;
  assert.deepEqual(Object.keys(first), ['isAuthenticating']); assert.equal(first.isAuthenticating(), true);
  f.replaceIntent(); assert.equal(f.render().props.authentication, first);
  f.current().id = 'request-2'; const next = f.render().props.authentication;
  assert.notEqual(next, first); assert.equal(first.isAuthenticating(), false); assert.equal(next.isAuthenticating(), true);
});

test('Smart warning acknowledgement has a visible checkbox and gates approval to the current intent', () => {
  const f = fixture();
  f.current().requiresWarningAcknowledgement = true;
  let tree = f.render();
  const checkbox = () => nodes(tree.props.before).find(node => node.props.accessibilityRole === 'checkbox')!;
  assert.equal(checkbox().props.accessibilityState.checked, false);
  assert.equal(checkbox().props.style.minHeight, 48);
  const box = nodes(checkbox()).find(node => node.type === 'View')!;
  assert.equal(box.props.style[0].width, 24);
  assert.equal(box.props.style[0].height, 24);
  assert.equal(box.props.style[0].borderWidth, 1);
  assert.equal(tree.props.disabled, true);
  tree.props.authorize();
  assert.deepEqual(f.calls, []);
  checkbox().props.onPress(); tree = f.render();
  assert.equal(checkbox().props.accessibilityState.checked, true);
  assert(nodes(checkbox()).some(node => node.children.includes('✓')));
  assert.equal(tree.props.disabled, false);
  tree.props.authorize();
  assert.deepEqual(f.calls, [['approve', 'request-1', 7, true]]);
  f.replaceIntent(); tree = f.render();
  assert.equal(checkbox().props.accessibilityState.checked, false);
  assert.equal(tree.props.disabled, true);
  tree.props.authorize();
  assert.equal(f.calls.length, 1);
});

test('Smart address warnings show the exact flagged address and warning tone before consent', () => {
  const f = fixture(), address = '0x' + '12'.repeat(20), unknown = '0x' + '34'.repeat(20);
  f.current().advisories = [
    { field: 'Recipient', address, reason: 'Known unsafe recipient', severity: 'high' },
    { field: 'Token contract', address: unknown, severity: 'medium' },
  ];
  const notices = nodes(f.render().props.before).filter(node => node.type === 'Notice');
  assert.equal(notices.length, 2);
  assert.equal(notices[0]!.props.tone, 'amber');
  assert.equal(notices[0]!.props.body, `${address}\nKnown unsafe recipient`);
  assert.equal(notices[1]!.props.tone, 'amber');
  assert.equal(notices[1]!.props.body, `${unknown}\nThis address appears on a known unsafe-address list.`);
  assert.deepEqual(f.calls, []);
});
