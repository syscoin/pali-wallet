import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
function fixture() {
  let cursor = 0;
  const hooks: any[] = [];
  const calls: unknown[] = [];
  let current: any = {
    kind: 'smart-transaction', id: 'request-1', revision: 7, error: null,
    needsAccountSwitch: false, busy: false, dispatched: false,
    appName: 'Fixture app', origin: 'https://fixture.example', verification: { validation: 'UNKNOWN', isScam: false },
    approval: { canEditAmount: true }, advisories: [], requiresWarningAcknowledgement: false,
    operation: { phase: 'authorize', intent: { kind: 'dapp-call', recipient: '0x' + '11'.repeat(20), amountUnits: '0', data: '0x1234' } },
  };
  const controller = {
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
    useState(initial: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value: unknown) => { hooks[index] = value; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
  };
  const imports: Record<string, unknown> = {
    './useDappLedgerConnection': {
      // This fixture reviews software-owner approval and allowance editing.
      useDappLedgerConnection: () => ({
        blocked: false, showConnect: false, modal: null,
        canApprove: () => true,
      }),
    },
    react, 'react-native': { StyleSheet: { create: (value: unknown) => value }, BackHandler: { addEventListener: () => ({ remove() {} }) } },
    './NativeSmartAccountOperation': { NativeSmartAccountOperationContent: 'Content' },
    './ApprovalReview': { ApprovalReview: 'Approval' }, './DappSiteStatus': { DappSiteStatus: 'Site' },
    './IdleActivityBoundary': { IdlePressable: 'Pressable' },
    '../ui': { Button: 'Button', Card: 'Card', Notice: 'Notice', Text: 'Text' },
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
});
test('dirty Smart allowance cannot authorize and a stale editor callback cannot clear the newer edit', () => {
  const f = fixture(); const first = f.render(); const old = approval(first);
  old.props.onEditingChange(true); f.render().props.authorize(); assert.equal(f.calls.length, 0);
  f.replaceIntent(); const next = f.render(); approval(next).props.onEditingChange(true);
  old.props.onEditingChange(false);
  f.render().props.authorize(); assert.equal(f.calls.length, 0);
  approval(f.render()).props.onEditingChange(false); f.render().props.authorize(); assert.equal(f.calls.length, 1);
});
