import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import { freshSmartOperationDeadline } from './nonSuiteSigningHandoff.ts';
import { normalizeNftTokenId } from '../../../source/utils/nftTokenId.ts';
import type { SavedCollectible } from '../src/portfolio/tokenRegistry.ts';
import { parseErc20Units, formatTokenUnits, type Erc20Metadata } from '../../../source/shared/erc20.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NativeRecipientResolver, NativeRecipientResolution } from '../src/portfolio/nativeRecipientResolver.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { getNativeSendContext, getNativeNetwork } from '../src/custody/networkContext.ts';
import { NativeSmartAccountOperation, type PreparedSmartAccountOperation, type SmartAccountPayerReview } from '../src/smartAccount/operation.ts';
import { encodeSmartAccountGasLimits, encodeSmartAccountGasFees } from '../../../source/utils/smartAccount/account.ts';

type Element = {
  type: unknown;
  props: Record<string, any>;
  children: unknown[];
};
const all = (node: any): Element[] =>
  Array.isArray(node)
    ? node.flatMap(all)
    : node && typeof node === 'object' && 'children' in node
    ? [node, ...node.children.flatMap(all), ...all(node.props.footer), ...all(node.props.trailing)]
    : [];
const source = readFileSync(
  new URL('../src/screens/NativeSmartAccountSend.tsx', import.meta.url),
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
function fixture(open: (...args: any[]) => Promise<any>, token?: Erc20Metadata, collectible?: SavedCollectible, recipientResolver?: NativeRecipientResolver) {
  let account={ address: '0x1111111111111111111111111111111111111111', network: 'ethereum', revision: 1 };
  const balance = { account, status: 'available', units: '5000000000000000000' };
  const inventory = { status: 'ready', account, items: token ? [{ metadata: token, status: 'available', units: '100' }] : [] };
  const events = new Map<string, (...args: any[]) => void>();
  const cells: any[] = [],
    cleanups: (() => void)[] = [];
  let index = 0;
  const cell = (initial: () => any) => {
    const at = index++;
    return cells[at] ?? (cells[at] = initial());
  };
  const react = {
    createElement: (type: unknown, props: any, ...children: unknown[]) => ({
      type,
      props: props ?? {},
      children,
    }),
    useState(initial: unknown) {
      const value = cell(() => ({ value: initial }));
      return [
        value.value,
        (next: unknown) => {
          value.value = typeof next === 'function' ? next(value.value) : next;
        },
      ];
    },
    useRef(initial: unknown) {
      return cell(() => ({ current: initial }));
    },
    useCallback(callback: unknown) { return cell(() => callback); },
    useMemo(create: () => unknown) {
      return cell(create);
    },
    useEffect(run: () => (() => void) | undefined, deps?: readonly unknown[]) {
      react.useLayoutEffect(run,deps);
    },
    useLayoutEffect(run: () => (() => void) | undefined, deps?: readonly unknown[]) {
      const value=cell(() => {
        const entry:{deps?:readonly unknown[];cleanup?:()=>void}={};
        cleanups.push(()=>entry.cleanup?.());
        return entry;
      });
      if(deps&&value.deps&&deps.length===value.deps.length&&deps.every((item,index)=>Object.is(item,value.deps[index])))return;
      value.cleanup?.();value.cleanup=run()||undefined;value.deps=deps;
    },
    useSyncExternalStore(_subscribe: unknown, get: () => unknown) {
      return get();
    },
  };
  const imports: Record<string, any> = {
    react,
    '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    'react-native': {
      ActivityIndicator: 'ActivityIndicator',
      AppState: { currentState: 'active', addEventListener(event: string, callback: (...args: any[]) => void) { events.set(event, callback); return { remove() { events.delete(event); } }; } },
      BackHandler: { addEventListener: () => ({ remove() {} }) },
      Keyboard: { dismiss() {} },
      KeyboardAvoidingView: 'KeyboardAvoidingView',
      Modal: 'Modal', View: 'View', StyleSheet: { create: (value: unknown) => value },
      Platform: { OS: 'android' },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../portfolio/nativePortfolio': {
      NativePortfolioController: class {
        subscribe() {
          return () => {};
        }
        getSnapshot() {
          return balance;
        }
        connect() {
          return () => {};
        }
      },
      sameNativePortfolioAccount: (left: any, right: any) => left?.address === right?.address && left?.network === right?.network && left?.revision === right?.revision,
    },
    '../core/amounts': { formatBaseUnits },
    '../../../../source/shared/erc20': { formatTokenUnits, parseErc20Units },
    '../../../../source/utils/nftTokenId': { normalizeNftTokenId },
    './NativeTokenMaximum': { NativeTokenMaximum: 'TokenMaximum', nativeTokenAvailableAmount: (asset: Erc20Metadata) => formatTokenUnits('100', asset.decimals) },
    './SendNetworkCard': { SendNetworkCard: 'SendNetworkCard' },
    './SendAssetSelector': { SendAssetSelector: 'SendAssetSelector' },
    './RecipientQrScanner': { RecipientQrScanner: 'RecipientQrScanner' },
    './NativeSend': {
      NativeSendInput: 'Input',
      nativeTransferFailure: (error: Error) =>
        error.message === 'INVALID_INPUT'
          ? 'Check recipient and amount'
          : 'This request could not be completed',
    },
    './NativeSmartAccountOperation': {
      NativeSmartAccountOperationScreen: 'Operation',
    },
    '../ui': {
      Button: 'Button',
      Card: 'Card', Coin: 'Coin', IconButton: 'IconButton',
      Header: 'Header',
      Notice: 'Notice',
      Screen: 'Screen',
      Text: 'Text',
      colors: {},
      styles: {},
    },
  };
  const module = { exports: {} as any };
  runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    require(name: string) {
      assert(Object.hasOwn(imports, name), name);
      return imports[name];
    },
  });
  const render = () => {
    index = 0;
    return module.exports.NativeSmartAccountSend({
      open,
      account,recipientResolver,
      context: getNativeSendContext('ethereum'),
      accountLabel: 'Smart account',
      source: {},
      reader: {},
      token, collectible, tokenView: token ? { subscribe: () => () => {}, connect: () => () => {},
        getSnapshot: () => inventory } : undefined,
      onBack() {},
    }) as Element;
  };
  const edit = (label: string, value: string) => {
    const field = all(render()).find(
      (node) => node.type === 'Input' && node.props.label === label
    );
    assert(field);
    field.props.onChange(value);
  };
  const press = () => {
    const button = all(render()).find(
      (node) => node.type === 'Button' && node.props.title === 'Review transfer'
    );
    assert(button);
    button.props.onPress();
  };
  return {
    render,
    edit,
    press,
    changeAccount(){account={...account,revision:account.revision+1};balance.account=account;inventory.account=account;},
    changeNetwork(){account={...account,network:'sepolia'};},
    background(){(imports['react-native'].AppState as any).currentState='background';events.get('change')?.('background');},
    close: () => cleanups.forEach((close) => close()),
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function scanner(f: ReturnType<typeof fixture>) {
  const input = all(f.render()).find(node => node.type === 'Input' && node.props.label === 'Recipient address');
  assert(input); input.props.trailing.props.onPress();
  const view = all(f.render()).find(node => node.type === 'RecipientQrScanner'); assert(view); return view;
}

test('Smart recipient scan fills only the address and preserves amount without opening an operation', () => {
  let opened = 0;
  const f = fixture(async () => { opened++; return { dispose() {} }; });
  try {
    f.edit('Amount in ETH', '0.25');
    scanner(f).props.onScan('0x2222222222222222222222222222222222222222');
    const fields = all(f.render()).filter(node => node.type === 'Input');
    assert.equal(fields.find(node => node.props.label === 'Recipient address')!.props.value, '0x2222222222222222222222222222222222222222');
    assert.equal(fields.find(node => node.props.label === 'Amount in ETH')!.props.value, '0.25');
    assert.equal(all(f.render()).some(node => node.type === 'RecipientQrScanner'), false);
    assert.equal(opened, 0);
  } finally { f.close(); }
});

for (const boundary of ['close', 'account', 'network', 'draft', 'background', 'unmount'] as const)
  test(`Smart recipient scan refuses a late result after ${boundary}`, () => {
    let opened = 0;
    const f = fixture(async () => { opened++; return { dispose() {} }; });
    const previous = scanner(f);
    if (boundary === 'close') previous.props.onClose();
    if (boundary === 'account') { f.changeAccount(); f.render(); }
    if (boundary === 'network') { f.changeNetwork(); f.render(); }
    if (boundary === 'draft') f.edit('Amount in ETH', '0.5');
    if (boundary === 'background') f.background();
    if (boundary === 'unmount') f.close();
    previous.props.onScan('0x2222222222222222222222222222222222222222');
    if (boundary === 'background') assert(all(f.render()).some(node => node.children.includes('Closing transfer review…')));
    else assert.equal(all(f.render()).find(node => node.type === 'Input' && node.props.label === 'Recipient address')!.props.value, '');
    assert.equal(opened, 0); f.close();
  });

test('Smart send form displays the shared balance and binds exact fields to its operation', async () => {
  const requests: any[][] = [];
  const operation = { dispose() {} };
  const f = fixture(async (...args) => {
    requests.push(args);
    return operation;
  });
  try {
    const initial = all(f.render());
    assert.equal(initial.find(node => node.type === 'Header')!.props.title, 'Send ETH');
    assert.equal(initial.find(node => node.type === 'Header')!.props.subtitle, 'Smart account · Ethereum');
    assert.equal(initial.find(node => node.type === 'SendNetworkCard')!.props.context.name, 'Ethereum');
    assert.match(initial.find(node => node.props.accessibilityLabel === 'Available balance')!.children.join(''), /Available 5\.0 ETH/);
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    f.edit('Amount in ETH', '0.000000000000000009');
    f.press();
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0]!.slice(0, 2))), [
      '0x2222222222222222222222222222222222222222',
      { kind: 'exact', amount: '0.000000000000000009' },
    ]);
    assert.equal(f.render().type, 'Operation');
    assert.equal(f.render().props.controller, operation);
  } finally {
    f.close();
  }
});

test('leaving during Smart operation opening disposes the late result', async () => {
  let resolve!: (value: any) => void,
    disposed = 0;
  const f = fixture(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
  f.edit('Amount in ETH', '1');
  f.press();
  assert(
    all(f.render())
      .filter((node) => node.type === 'Input')
      .every((node) => node.props.busy)
  );
  f.close();
  resolve({
    dispose() {
      disposed++;
    },
  });
  await tick();
  assert.equal(disposed, 1);
  assert.notEqual(f.render().type, 'Operation');
});

for (const message of ['INVALID_INPUT', 'NOT_READY'])
  test(`opening failure has appropriate feedback (${message})`, async () => {
    const f = fixture(async () => {
      throw new Error(message);
    });
    try {
      f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
      f.edit('Amount in ETH', '1');
      f.press();
      await tick();
      const notice = all(f.render()).find((node) => node.type === 'Notice');
      assert(notice);
      assert.equal(
        notice.props.body,
        message === 'INVALID_INPUT'
          ? 'Check recipient and amount'
          : 'This request could not be completed'
      );
    } finally {
      f.close();
    }
  });


for (const editAmount of [false, true]) test(`MAX selection ${editAmount ? 'clears when amount is edited' : 'uses the explicit maximum request'}`, async () => {
  let selected: any;
  const f = fixture(async (_recipient, amount) => { selected = amount; return { dispose() {} }; });
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    const maximum = all(f.render()).find(node => node.type === 'Button' && node.props.title === 'MAX')!;
    assert.equal(maximum.props.disabled, false);
    maximum.props.onPress();
    assert(all(f.render()).some(node => node.type === 'Button' && node.props.title === 'MAX selected'));
    if (editAmount) f.edit('Amount in ETH', '1');
    f.press(); await tick();
    assert.equal(selected.kind, editAmount ? 'exact' : 'maximum');
    if (editAmount) assert.equal(selected.amount, '1');
  } finally { f.close(); }
});


test('Smart token form presents the selected contract and routes exact decimal input', async () => {
  const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 255, name: 'Exact token', symbol: 'EXACT' };
  let request: any;
  const f = fixture(async (_recipient, amount) => { request = amount; return { dispose() {} }; }, token);
  try {
    const details = all(f.render()).find(node => node.type === 'Button' && node.props.title === 'Details'); assert(details); details.props.onPress();
    assert(all(f.render()).some(node => node.children.includes(token.contractAddress)));
    assert(all(f.render()).some(node => node.type === 'TokenMaximum'));
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    const amount = '0.' + '0'.repeat(254) + '9';
    f.edit('Amount in EXACT', amount);
    f.press(); await tick();
    assert.equal(request.kind, 'erc20');
    assert.equal(request.contractAddress, token.contractAddress);
    assert.equal(request.amount, amount);
  } finally { f.close(); }
});


for (const standard of ['ERC-721', 'ERC-1155'] as const) test(`Smart ${standard} form binds saved item and exact quantity`, async () => {
  const contractAddress = '0x6666666666666666666666666666666666666666';
  const collectible: SavedCollectible = standard === 'ERC-721' ? { contractAddress, tokenStandard: standard } : { contractAddress, tokenStandard: standard, tokenId: '7' };
  let sent: any;
  const f = fixture(async (_recipient, request) => { sent = request; return { dispose() {} }; }, undefined, collectible);
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    if (standard === 'ERC-721') f.edit('Token ID', '7');
    else f.edit('Quantity', '9007199254740993');
    f.press(); await tick();
    assert.equal(sent.kind, 'nft');
    assert.equal(sent.collectible, collectible);
    assert.equal(sent.tokenId, '7');
    assert.equal(sent.amountUnits, standard === 'ERC-721' ? '1' : '9007199254740993');
  } finally { f.close(); }
});


test('invalid NFT identifiers stay in the form with a specific field message', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { dispose() {} }; }, undefined,
    { contractAddress: '0x6666666666666666666666666666666666666666', tokenStandard: 'ERC-721' });
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    f.edit('Token ID', '-1'); f.press(); await tick();
    assert.equal(calls, 0);
    assert.equal(all(f.render()).find(node => node.type === 'Notice')!.props.body, 'Enter a valid token ID.');
  } finally { f.close(); }
});

for (const editAmount of [false, true]) test(`Smart token MAX remains an exact ERC20 request${editAmount ? ' after editing' : ''}`, async () => {
  const token = { contractAddress: '0x5555555555555555555555555555555555555555', decimals: 255, name: 'Exact token', symbol: 'EXACT' };
  let request: any;
  const f = fixture(async (_recipient, amount) => { request = amount; return { dispose() {} }; }, token);
  try {
    f.edit('Recipient address', '0x2222222222222222222222222222222222222222');
    const maximum = all(f.render()).find(node => node.type === 'TokenMaximum')!;
    maximum.props.onSelect(formatTokenUnits('1', 255));
    assert(all(f.render()).find(node => node.type === 'TokenMaximum')!.props.selected);
    if (editAmount) f.edit('Amount in EXACT', formatTokenUnits('2', 255));
    assert.equal(all(f.render()).find(node => node.type === 'TokenMaximum')!.props.selected, !editAmount);
    f.press(); await tick(); assert.equal(request.kind, 'erc20');
    assert.equal(request.amount, formatTokenUnits(editAmount ? '2' : '1', 255));
  } finally { f.close(); }
});

function heldTicket(input:string,guard:()=>void){
  const abort=new AbortController();
  const ticket:NativeRecipientResolution={input,address:'0x2222222222222222222222222222222222222222',expiresAt:Date.now()+1000,signal:abort.signal,
    assertCurrent(){guard();if(abort.signal.aborted)throw new Error('RECIPIENT_EXPIRED');},dispose(){abort.abort();}};
  return{ticket,expire:()=>abort.abort()};
}
test('Smart ENS resolves once, displays the binding and retains it for operation approval',async()=>{
  let requests:any[][]=[],lookups=0,current!:ReturnType<typeof heldTicket>;
  const f=fixture(async(...args)=>{requests.push(args);return{dispose(){},getSnapshot(){return{userOperationSubmissionStarted:false};},subscribe(){return()=>{};}};},undefined,undefined,
    {async resolve(input,_owner,_signal,guard){lookups++;current=heldTicket(input,guard);return current.ticket;}});
  f.edit('Recipient address','recipient.eth');f.edit('Amount in ETH','1');f.press();await tick();
  assert.equal(requests[0]![0],current.ticket.address);requests[0]![2]();assert.equal(lookups,1);
  const text=all(f.render()).flatMap(node=>node.children).join(' ');assert.match(text,/recipient.eth/);assert.match(text,/Resolved address/);
  current.expire();assert.throws(requests[0]![2],/RECIPIENT_EXPIRED/);f.close();
});
for(const change of ['edit','account','close'] as const)test(`Smart held ENS cannot open after ${change}`,async()=>{
  let complete!:(ticket:NativeRecipientResolution)=>void,guard!:()=>void,opened=0;
  const f=fixture(async()=>{opened++;return{dispose(){}};},undefined,undefined,
    {resolve(_input,_owner,_signal,check){guard=check;return new Promise(resolve=>{complete=resolve;});}});
  f.edit('Recipient address','old.eth');f.edit('Amount in ETH','1');f.press();
  if(change==='edit')f.edit('Recipient address','0x3333333333333333333333333333333333333333');
  if(change==='account'){f.changeAccount();f.render();}
  if(change==='close')f.close();
  complete(heldTicket('old.eth',guard).ticket);await tick();assert.equal(opened,0);f.close();
});
test('Smart lookup refusal keeps custody operation unopened',async()=>{
  let opened=0;const f=fixture(async()=>{opened++;return{dispose(){}};},undefined,undefined,{async resolve(){throw new Error('ENS_UNAVAILABLE');}});
  f.edit('Recipient address','missing.eth');f.edit('Amount in ETH','1');f.press();await tick();assert.equal(opened,0);f.close();
});

const operationHash = `0x${'ab'.repeat(32)}`;
const fundingHash = `0x${'cd'.repeat(32)}`;
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function ensOperation(fundFirst = false, loseReply = false) {
  const beforeWire = gate(), afterFunding = gate(), reply = gate();
  let ticket!: ReturnType<typeof heldTicket>;
  let model!: NativeSmartAccountOperation;
  let sending: Promise<void> | undefined;
  let check!: () => void;
  let lateBroadcast!: (hash: string, purpose: SmartAccountPayerReview['purpose']) => void;
  let signatures = 0, fundingWires = 0, operationWires = 0;
  const f = fixture(async (recipient, _amount, assertCurrent) => {
    check = assertCurrent;
    const intent = { kind: 'native-transfer' as const, recipient, amountUnits: '1' };
    const prepared = {
      actionHash: operationHash,
      executions: [{ target: recipient, value: '1', data: '0x' }],
      userOperation: {
        accountGasLimits: encodeSmartAccountGasLimits({ callGasLimit: 1, verificationGasLimit: 1 }),
        gasFees: encodeSmartAccountGasFees({ maxFeePerGas: 2, maxPriorityFeePerGas: 1 }),
        preVerificationGas: '1', paymasterAndData: '0x',
      },
    } as PreparedSmartAccountOperation;
    model = new NativeSmartAccountOperation({ background() {}, authorizationExpiresAt: freshSmartOperationDeadline(),
      account: '0x1111111111111111111111111111111111111111',
      network: getNativeNetwork('ethereum'), intent, assertCurrent,
      async prepare() { return { kind: 'authorization', intent, operation: prepared }; },
      async sign() { signatures++; return '0xsignature'; },
      async submit(_prepared, _signature, _signal, guard, review, onBroadcast) {
        lateBroadcast = onBroadcast;
        const reviewFee = (purpose: SmartAccountPayerReview['purpose']) => review({
          purpose, transaction: {
            chainId: '1', from: intent.recipient, to: intent.recipient, nonce: '0',
            value: '0', data: '0x', gasLimit: '21000', type: 2,
            maxFeePerGas: '2', maxPriorityFeePerGas: '1', accessList: [],
          }, coveredFeeUnits: '0', maximumFeeUnits: '42000', maximumTotalUnits: '42000',
        }, guard);
        await reviewFee(fundFirst ? 'fund-account' : 'submit-operation');
        await beforeWire.promise;
        guard();
        if (fundFirst) {
          onBroadcast(fundingHash, 'fund-account'); fundingWires++;
          await afterFunding.promise;
          guard();
          await reviewFee('submit-operation');
          guard();
        }
        // The real transport invokes this only after admission, before POST.
        onBroadcast(operationHash, 'submit-operation'); operationWires++;
        await reply.promise;
        guard();
        if (loseReply) throw new Error('reply lost after delivery');
        return operationHash;
      },
    });
    return model;
  }, undefined, undefined, {
    async resolve(input, _owner, _signal, guard) {
      ticket = heldTicket(input, guard);
      return ticket.ticket;
    },
  });
  f.edit('Recipient address', 'recipient.eth');
  f.edit('Amount in ETH', '0.000000000000000001');
  f.press(); await tick();
  await model.prepare();
  sending = model.authorize(model.getSnapshot().revision);
  await tick();
  assert.equal(model.getSnapshot().phase, 'review-fee');
  const approve = () => model.confirmPayer(model.getSnapshot().payerReview!.id);
  return {
    f, model, ticket, check, approve, beforeWire, afterFunding, reply,
    counts: () => ({ signatures, fundingWires, operationWires }),
    lateBroadcast: () => lateBroadcast(operationHash, 'submit-operation'),
    settle: () => sending!,
    async close() {
      beforeWire.release(); afterFunding.release(); reply.release();
      f.close(); await sending; await model.dispose();
    },
  };
}
const shownOperation = (f: ReturnType<typeof fixture>) =>
  all(f.render()).find(node => node.type === 'Operation')?.props.controller;

test('Smart ENS expiry before the final POST retains no submission authority, even in waiting', async () => {
  const t = await ensOperation();
  try {
    t.approve();
    assert.equal(t.model.getSnapshot().phase, 'waiting');
    assert.equal(t.model.getSnapshot().userOperationSubmissionStarted, false);
    t.ticket.expire(); t.beforeWire.release(); await t.settle();
    assert.equal(shownOperation(t.f), undefined);
    assert.equal(t.counts().operationWires, 0);
    assert.throws(t.check, /RECIPIENT_EXPIRED/);
  } finally { await t.close(); }
});

test('Smart ENS funding broadcast cannot release lookup authority for the later UserOperation', async () => {
  const t = await ensOperation(true);
  try {
    t.approve(); t.beforeWire.release(); await tick();
    assert.equal(t.model.getSnapshot().transactionHash, fundingHash);
    assert.equal(t.model.getSnapshot().userOperationSubmissionStarted, false);
    assert.equal(t.ticket.ticket.signal.aborted, false);
    t.ticket.expire(); t.afterFunding.release(); await t.settle();
    assert.equal(shownOperation(t.f), undefined);
    assert.deepEqual(t.counts(), { signatures: 1, fundingWires: 1, operationWires: 0 });
  } finally { await t.close(); }
});

for (const outcome of ['complete', 'completed-before-expiry', 'lost-reply'] as const)
  test(`Smart ENS retains the same submitted operation through held POST, TTL and ${outcome}`, async () => {
    const t = await ensOperation(false, outcome === 'lost-reply');
    try {
      t.approve(); t.beforeWire.release(); await tick();
      assert.equal(t.model.getSnapshot().userOperationSubmissionStarted, true);
      assert.equal(t.model.getSnapshot().transactionHash, operationHash);
      assert.equal(t.model.getSnapshot().phase, 'waiting');
      if (outcome === 'completed-before-expiry') {
        t.reply.release(); await t.settle();
        assert.equal(t.model.getSnapshot().phase, 'complete');
      }
      // Releasing the resolved-name review aborts its ticket synchronously.
      const retiredAtSubmission = t.ticket.ticket.signal.aborted;
      t.ticket.expire();
      assert.equal(shownOperation(t.f), t.model);
      t.check();
      assert.equal(retiredAtSubmission, true);
      t.reply.release(); await t.settle();
      assert.equal(t.model.getSnapshot().phase, outcome === 'lost-reply' ? 'failed' : 'complete');
      assert.equal(t.model.getSnapshot().transactionHash, operationHash);
      t.ticket.expire();
      assert.equal(shownOperation(t.f), t.model);
      assert.equal(all(t.f.render()).some(node => node.props.title === 'Review transfer'), false);
      await t.model.authorize(t.model.getSnapshot().revision);
      assert.deepEqual(t.counts(), { signatures: 1, fundingWires: 0, operationWires: 1 });
    } finally { await t.close(); }
  });

for (const change of ['account', 'network', 'close'] as const)
  test(`Smart ENS submission releases no ${change} ownership guard`, async () => {
    const t = await ensOperation();
    try {
      t.approve(); t.beforeWire.release(); await tick();
      assert.equal(t.model.getSnapshot().userOperationSubmissionStarted, true);
      if (change === 'account') { t.f.changeAccount(); t.f.render(); }
      if (change === 'network') { t.f.changeNetwork(); t.f.render(); }
      if (change === 'close') t.f.close();
      assert.throws(t.check, /RECIPIENT_EXPIRED/);
      t.reply.release(); await t.settle();
      assert.equal(t.model.getSnapshot().transactionHash, operationHash);
      assert.equal(t.counts().operationWires, 1);
    } finally { await t.close(); }
  });

test('Smart ENS a late broadcast marker cannot release a retired lookup or replacement owner', async () => {
  const t = await ensOperation();
  try {
    t.approve(); t.f.changeAccount(); t.f.render();
    t.lateBroadcast();
    assert.throws(t.check, /RECIPIENT_EXPIRED/);
    t.beforeWire.release(); await t.settle();
    assert.equal(t.counts().operationWires, 0);
    assert.notEqual(t.model.getSnapshot().phase, 'complete');
  } finally { await t.close(); }
});

test('Smart ENS a late marker cannot release the review of a canceled operation', async () => {
  const t = await ensOperation();
  try {
    t.approve(); t.model.cancel(); t.lateBroadcast();
    assert.equal(t.model.getSnapshot().phase, 'failed');
    assert.equal(t.model.getSnapshot().transactionHash, operationHash);
    assert.equal(t.ticket.ticket.signal.aborted, false);
    t.ticket.expire();
    assert.equal(shownOperation(t.f), undefined);
    assert.throws(t.check, /RECIPIENT_EXPIRED/);
    t.beforeWire.release(); await t.settle();
    assert.equal(t.counts().operationWires, 0);
  } finally { await t.close(); }
});
