import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NativeRecipientResolver, NativeRecipientResolution } from '../src/portfolio/nativeRecipientResolver.ts';
import type { NativeUnsignedSendDraft } from '../src/screens/sendNetworkDraft.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
function setup(token?: { contractAddress: string; decimals: number; symbol: string; name: string }, beforeClose?: () => Promise<void>, recipientResolver?: NativeRecipientResolver, onChangeNetwork?: (draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>) => void, onViewTransaction?: (hash: string) => void) {
  const cells: Cell[] = [], effects: (() => void)[] = []; let cursor = 0;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props: props ?? {}, children }; },
    useState(initial: unknown) { const c=cell(); if (!Object.hasOwn(c,'value')) c.value=typeof initial==='function'?(initial as () => unknown)():initial;
      c.setter ??= (next: unknown)=>{c.value=typeof next==='function'?(next as (old: unknown)=>unknown)(c.value):next;}; return [c.value,c.setter]; },
    useRef(initial: unknown) { const c=cell(); c.value ??= {current: initial}; return c.value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { const c=cell(); if(!c.deps || deps.some((d,i)=>!Object.is(d,c.deps![i]))) {c.value=callback;c.deps=deps;} return c.value; },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) { const c=cell(); if(deps&&c.deps&&deps.length===c.deps.length&&deps.every((d,i)=>Object.is(d,c.deps![i]))) return;
      c.deps=deps; effects.push(()=>{c.cleanup?.();c.cleanup=callback() || undefined;}); },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) { react.useLayoutEffect(callback,deps); },
    useSyncExternalStore(_subscribe: unknown, read: () => unknown) {cell();return read();},
  };
  let hardware: (()=>boolean)|undefined, backs=0, cancels=0;
  const native={Platform:{OS:'android'},BackHandler:{addEventListener(_name:string, cb:()=>boolean){hardware=cb;return{remove(){hardware=undefined;}};}},Keyboard:{dismiss(){}},StyleSheet:{create:(styles:unknown)=>styles},
    ...Object.fromEntries(['ActivityIndicator','KeyboardAvoidingView','Modal','ScrollView','View'].map(name=>[name,name]))};
  const ui={...Object.fromEntries(['Button','Card','Coin','Header','Icon','IconButton','Notice','Screen','Text'].map(name=>[name,name])),colors:{},styles:{}};
  const deps: Record<string,unknown> = {
    './TransactionAuthentication': { TransactionAuthentication: 'TransactionAuthentication' },
    './RecipientQrScanner': { RecipientQrScanner: 'RecipientQrScanner' },
    './SendNetworkCard': { SendNetworkCard: 'SendNetworkCard' },
    './NativeLedger': { NativeLedgerConnectionModal: 'NativeLedgerConnectionModal' },
    './NativeTokenMaximum': { NativeTokenMaximum: 'TokenMaximum', nativeTokenAvailableAmount: (token: { balance?: string }) => token.balance },
    react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'../ui':ui,
    './IdleActivityBoundary':{IdlePressable:'IdlePressable',IdleTextInput:'IdleTextInput'},
    '../core/amounts':{formatBaseUnits:()=>''},
    '../../../../source/shared/erc20':{formatTokenUnits:()=>'',parseErc20Units:()=>''},
    '../../../../source/shared/evmRecipientChoices':{findLocalEvmRecipientChoices:()=>[]},
    '../../../../source/utils/nftTokenId':{normalizeNftTokenId:()=>''},
    '../custody/transfers':{ASSET_STATE_SAVED_MESSAGE:'saved',ASSET_STATE_WAIT_MESSAGE:'wait'},
  };
  const source=readFileSync(new NodeURL('../src/screens/NativeSend.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const module={exports:{} as Record<string,any>};
  runInNewContext(code,{module,exports:module.exports,Error,URL,AbortController,Keyboard:native.Keyboard,require(name:string){assert.ok(Object.hasOwn(deps,name),`Unexpected import ${name}`);return deps[name];}});
  let snapshot: any={phase:'submitting',review:null,hash:null,message:null,intent:null,collectible:undefined};
  const prepared: unknown[] = [];
  const confirmed: string[] = [];
  let confirmationGate: Promise<void> | undefined, signatures = 0;
  const prepare = async (recipient: string, amount: string, nonce?: string) => {
    prepared.push([recipient, amount, nonce]); snapshot = { ...snapshot, phase: 'review', review: {
      id: 'review', recipient, context, amountUnits: '1', maximumFeeUnits: '1', totalUnits: '2' } };
  };
  const controller={getSnapshot:()=>snapshot,subscribe:()=>()=>{},cancel(){cancels++;snapshot={...snapshot,phase:'idle',review:null};},prepare,
    async confirm(id: string) {
      const approved = snapshot.review; confirmed.push(id);
      if (confirmationGate) await confirmationGate;
      if (snapshot.review !== approved) throw Error('CANCELLED');
      signatures++;
    }, async prepareToken(...args: unknown[]) { prepared.push(args); }};
  const context={networkId:'ethereum',name:'Ethereum',symbol:'ETH',chainId:1,rpcUrl:'https://example.invalid',testnet:false};
  let account={address:'0x1111111111111111111111111111111111111111',network:'ethereum',revision:1};
  const render=()=>{cursor=0;const tree=module.exports.NativeSend({controller,context,token,beforeClose,recipientResolver,account,authenticationMethod:'password',onChangeNetwork,onViewTransaction,onBack(){backs++;}}) as Element;effects.splice(0).forEach(run=>run());return tree;};
  return {render,prepared,confirmed,get snapshot(){return snapshot;},setSnapshot(value: any){snapshot=value;},controller,
    holdConfirmation(wait: Promise<void>) { confirmationGate = wait; }, signatures: () => signatures,
    changeAccount(){account={...account,revision:2};},hardware:()=>{assert.ok(hardware);return hardware();},counts:()=>({backs,cancels}),dispose:()=>cells.forEach(c=>c.cleanup?.())};
}
function all(node: unknown): Element[] {if(!node||typeof node!=='object'||!('children' in node))return [];const e=node as Element;return [e,...e.children.flat(Infinity).flatMap(all),...all(e.props.footer),...all(e.props.trailing)];}
function one(tree:Element,type:string,predicate:(e:Element)=>boolean=()=>true) {const matches=all(tree).filter(e=>e.type===type&&predicate(e));assert.equal(matches.length,1);return matches[0]!;}
function modal(tree:Element){return one(tree,'Modal');}
function button(tree:Element,title:string){return one(tree,'Button',e=>e.props.title===title);}
function headerBack(tree:Element){one(tree,'Header').props.onBack();}
function authenticateSend(f: ReturnType<typeof setup>) {
  one(f.render(), 'TransactionAuthentication').props.onConfirm({ method: 'pin', pin: '123456' });
}
function openRecipientScanner(f: ReturnType<typeof setup>) {
  const field = all(f.render()).find(node => node.props.label === 'Ethereum address'); assert(field);
  assert.equal(field.props.trailing.props.label, 'Scan recipient address');
  field.props.trailing.props.onPress();
  return one(f.render(), 'RecipientQrScanner');
}

test('submitted transfer shows a checkmark and exact Activity action without manual refresh', () => {
  const viewed: string[] = [];
  const f = setup(undefined, undefined, undefined, undefined, hash => viewed.push(hash));
  f.setSnapshot({ ...f.snapshot, phase: 'pending', review: null, hash: '0xsubmitted' });
  const tree = f.render();
  assert.match(all(tree).flatMap(node => node.children.filter(child => typeof child === 'string')).join(' '), /Transaction submitted/);
  assert(one(tree, 'Icon', node => node.props.name === 'check'));
  assert.equal(all(tree).some(node => node.props.title === 'Check status' || node.props.title === 'Review retry'), false);
  button(tree, 'View transaction').props.onPress(); assert.deepEqual(viewed, ['0xsubmitted']);
  button(tree, 'Done').props.onPress(); assert.equal(f.counts().backs, 1); f.dispose();
});

test('uncertain submission retains explicit status and retry recovery controls', () => {
  const f = setup(); f.setSnapshot({ ...f.snapshot, phase: 'unknown', review: null, hash: '0xunknown' });
  const tree = f.render(); assert(button(tree, 'Check status')); assert(button(tree, 'Review retry'));
  assert.equal(all(tree).some(node => node.props.title === 'Done'), false); f.dispose();
});

for (const phase of ['confirmed', 'reverted']) test(`${phase} transfer keeps its actions in the footer`, () => {
  const viewed: string[] = [];
  const f = setup(undefined, undefined, undefined, undefined, hash => viewed.push(hash));
  f.setSnapshot({ ...f.snapshot, phase, review: null, hash: '0xcomplete' });
  const tree = f.render();
  const screen = one(tree, 'Screen');
  const footer = { type: 'footer', props: {}, children: [screen.props.footer] };
  button(footer, 'View transaction').props.onPress();
  assert.deepEqual(viewed, ['0xcomplete']);
  assert(button(footer, 'Done'));
  assert.equal(all(tree).some(node => node.props.title === 'Check status' || node.props.title === 'New transfer'), false);
  f.dispose();
});

test('recipient scan fills only the current draft and leaves amount and preparation unchanged', () => {
  const f = setup(); f.snapshot.phase = 'idle';
  editSend(f, 'Amount in ETH', '0.25');
  const scanner = openRecipientScanner(f);
  scanner.props.onScan('0x2222222222222222222222222222222222222222');
  const tree = f.render();
  assert.equal(all(tree).find(node => node.props.label === 'Ethereum address')!.props.value, '0x2222222222222222222222222222222222222222');
  assert.equal(all(tree).find(node => node.props.label === 'Amount in ETH')!.props.value, '0.25');
  assert.deepEqual(f.prepared, []); assert.deepEqual(f.confirmed, []);
  assert.equal(all(tree).some(node => node.type === 'RecipientQrScanner'), false); f.dispose();
});

for (const boundary of ['close', 'account', 'draft'] as const) test(`recipient scan cannot fill after ${boundary} changes`, () => {
  const f = setup(); f.snapshot.phase = 'idle';
  const scanner = openRecipientScanner(f);
  if (boundary === 'close') scanner.props.onClose();
  if (boundary === 'account') { f.changeAccount(); f.render(); }
  if (boundary === 'draft') editSend(f, 'Amount in ETH', '0.5');
  scanner.props.onScan('0x2222222222222222222222222222222222222222');
  assert.equal(all(f.render()).find(node => node.props.label === 'Ethereum address')!.props.value, '');
  assert.deepEqual(f.prepared, []); f.dispose();
});

test('draft network card exposes Change only when the parent provides it', () => {
  let changes = 0;
  const f = setup(undefined, undefined, undefined, () => { changes++; }); f.snapshot.phase = 'idle';
  assert.equal(one(f.render(), 'SendNetworkCard').props.context.name, 'Ethereum');
  openRecipientScanner(f); one(f.render(), 'SendNetworkCard').props.onChange();
  assert.equal(changes, 1); assert.equal(all(f.render()).some(node => node.type === 'RecipientQrScanner'), false);
  assert.deepEqual(f.prepared, []); f.dispose();
  const unavailable = setup(); unavailable.snapshot.phase = 'idle';
  assert.equal(one(unavailable.render(), 'SendNetworkCard').props.onChange, undefined); unavailable.dispose();
});

test('network Change captures unsigned form text without preparing or authorizing a transfer', () => {
  const captured: NativeUnsignedSendDraft[] = [];
  const f = setup(undefined, undefined, undefined, draft => captured.push(draft)); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '1.234567890123456789');
  one(f.render(), 'SendNetworkCard').props.onChange();
  assert.equal(captured.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(captured[0])), { kind: 'evm', recipient: '0x2222222222222222222222222222222222222222', amount: '1.234567890123456789', nonce: '', tokenId: '', max: false, advanced: false });
  assert.deepEqual(f.prepared, []); assert.deepEqual(f.confirmed, []); f.dispose();
});

test('review has one primary action and Header Back returns to the unchanged draft', async () => {
  const f = setup(); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '0.5'); reviewSend(f); await settle();
  let tree = f.render();
  assert.equal(all(tree).some(node => node.props.title === 'Edit transfer' || node.props.title === 'Close review'), false);
  assert(button(tree, 'Confirm and send')); headerBack(tree); tree = f.render();
  assert.equal(f.snapshot.review, null); assert.equal(f.counts().backs, 0);
  assert.equal(all(tree).find(node => node.props.label === 'Amount in ETH')!.props.value, '0.5');
  f.dispose();
});

test('send review opens authentication without confirming and cancellation preserves the exact review', async () => {
  const f = setup(); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
  const review = f.snapshot.review;
  button(f.render(), 'Confirm and send').props.onPress();
  const authentication = one(f.render(), 'TransactionAuthentication');
  assert.equal(authentication.props.method, 'password');
  assert.deepEqual(f.confirmed, []);
  authentication.props.onCancel();
  assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
  assert.strictEqual(f.snapshot.review, review); assert.equal(f.counts().cancels, 0);
  authentication.props.onConfirm({ method: 'pin', pin: 'stale' }); await settle();
  assert.deepEqual(f.confirmed, []); f.dispose();
});

test('authentication captured for a replaced review cannot confirm its successor', async () => {
  const f = setup(); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
  button(f.render(), 'Confirm and send').props.onPress();
  const authentication = one(f.render(), 'TransactionAuthentication');
  f.setSnapshot({ ...f.snapshot, review: { ...f.snapshot.review } }); f.render();
  authentication.props.onConfirm({ method: 'pin', pin: 'stale' }); await settle();
  assert.deepEqual(f.confirmed, []); f.dispose();
});

test('Back in a held authentication cancels the controller and discards its late outcome', async () => {
  const f = setup(), held = Promise.withResolvers<void>(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
    editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
    f.holdConfirmation(held.promise); button(f.render(), 'Confirm and send').props.onPress();
    const authentication = one(f.render(), 'TransactionAuthentication');
    authentication.props.onConfirm({ method: 'pin', pin: '123456' });
    assert.equal(one(f.render(), 'TransactionAuthentication').props.busy, true);
    authentication.props.onCancel();
    assert.equal(f.counts().cancels, 1); assert.equal(f.snapshot.review, null);
    assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
    held.resolve(); await settle();
    assert.equal(f.signatures(), 0);
    assert.equal(all(f.render()).some(node => node.props.accessibilityRole === 'alert'), false);
  } finally { held.resolve(); f.dispose(); }
});

test('signing and submitting retire authentication so submission Back uses the existing Leave prompt', async () => {
  const f = setup(), held = Promise.withResolvers<void>(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
    editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
    f.holdConfirmation(held.promise); button(f.render(), 'Confirm and send').props.onPress();
    const authentication = one(f.render(), 'TransactionAuthentication');
    authentication.props.onConfirm({ method: 'pin', pin: '123456' });
    f.snapshot.phase = 'signing';
    assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
    f.snapshot.phase = 'submitting'; let tree = f.render();
    assert.equal(all(tree).some(node => node.type === 'TransactionAuthentication'), false);
    authentication.props.onCancel(); assert.equal(f.counts().cancels, 0);
    headerBack(tree); tree = f.render(); assert.equal(modal(tree).props.visible, true);
    assert(button(tree, 'Stay')); assert(button(tree, 'Leave'));
  } finally { held.resolve(); await settle(); f.dispose(); }
});

test('header and Android Back request a dismissible warning while submitting',()=>{
 const f=setup();let tree=f.render();headerBack(tree);tree=f.render();assert.equal(modal(tree).props.visible,true);
 const content=all(tree).flatMap(e=>e.children.filter(v=>typeof v==='string')).join(' ');
 assert.match(content,/may already have been sent/);assert.match(content,/Check Activity before sending again/);
 assert.deepEqual(f.counts(),{backs:0,cancels:0});button(tree,'Stay').props.onPress();tree=f.render();assert.equal(modal(tree).props.visible,false);
 assert.equal(f.hardware(),true);tree=f.render();assert.equal(modal(tree).props.visible,true);
 modal(tree).props.onRequestClose();tree=f.render();assert.equal(modal(tree).props.visible,false);assert.deepEqual(f.counts(),{backs:0,cancels:0});f.dispose();
});
test('explicit Leave exits once even when a submission never completes',()=>{
 const f=setup();let tree=f.render();headerBack(tree);tree=f.render();const leave=button(tree,'Leave');leave.props.onPress();leave.props.onPress();
 assert.deepEqual(f.counts(),{backs:1,cancels:1});f.dispose();
});
test('an outcome arriving while the prompt is open is not discarded by stale Leave',()=>{
 const f=setup();let tree=f.render();headerBack(tree);tree=f.render();const staleLeave=button(tree,'Leave');f.snapshot.phase='pending';f.snapshot.hash='0xsynthetic';staleLeave.props.onPress();
 assert.deepEqual(f.counts(),{backs:0,cancels:0});tree=f.render();assert.equal(modal(tree).props.visible,false);f.dispose();
});
test('ordinary Back without a submission still exits directly',()=>{
 const f=setup();f.snapshot.phase='idle';const tree=f.render();headerBack(tree);assert.deepEqual(f.counts(),{backs:1,cancels:1});f.dispose();
});

test('hardware Back drains once before navigation and cannot publish after unmount', async () => {
 let release!: () => void, drains=0;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const f=setup(undefined,()=>{drains++;return pending;});
 f.snapshot.phase='idle';const tree=f.render();headerBack(tree);headerBack(tree);
 await new Promise(setImmediate);assert.equal(drains,1);assert.deepEqual(f.counts(),{backs:0,cancels:1});
 release();await new Promise(setImmediate);assert.deepEqual(f.counts(),{backs:1,cancels:1});f.dispose();
 let finish!:()=>void;
 const other=setup(undefined,()=>new Promise<void>(resolve=>{finish=resolve;}));
 other.snapshot.phase='idle';headerBack(other.render());await new Promise(setImmediate);other.dispose();
 finish();await new Promise(setImmediate);assert.equal(other.counts().backs,0);
});

test('failed hardware cleanup keeps the screen and allows Back to retry the drain', async () => {
 let drains=0;
 const f=setup(undefined,async()=>{if(++drains===1)throw Error('held transport');});
 f.snapshot.phase='idle';headerBack(f.render());await new Promise(setImmediate);
 assert.equal(f.counts().backs,0);
 const tree=f.render();assert.match(all(tree).flatMap(e=>e.children.filter(v=>typeof v==='string')).join(' '),/hardware request is still closing/);
 headerBack(tree);await new Promise(setImmediate);assert.equal(drains,2);assert.equal(f.counts().backs,1);f.dispose();
});

test('a later submission with a distinct review cannot resurrect the earlier warning',()=>{
 const f=setup();const first=Object.freeze({id:'same-test-id',context:{networkId:'ethereum',name:'Ethereum',symbol:'ETH'},amountUnits:'1',maximumFeeUnits:'1',totalUnits:'2',recipient:'0x1'});
 f.setSnapshot({...f.snapshot,review:first});let tree=f.render();headerBack(tree);tree=f.render();assert.equal(modal(tree).props.visible,true);
 const staleLeave=button(tree,'Leave');f.setSnapshot({...f.snapshot,phase:'pending',review:null,hash:'0xsynthetic'});tree=f.render();assert.equal(modal(tree).props.visible,false);
 f.setSnapshot({...f.snapshot,phase:'submitting',review:Object.freeze({...first}),hash:null});tree=f.render();assert.equal(modal(tree).props.visible,false);
 staleLeave.props.onPress();assert.deepEqual(f.counts(),{backs:0,cancels:0});headerBack(tree);tree=f.render();assert.equal(modal(tree).props.visible,true);f.dispose();
});

for (const edit of [false, true]) test(`ordinary token MAX uses exact existing prepareToken${edit ? ' after edit' : ''}`, async () => {
 const token={contractAddress:'0x2222222222222222222222222222222222222222',decimals:255,name:'Token',symbol:'T'};
 const f=setup(token);f.setSnapshot({phase:'idle',review:null,hash:null,message:null,intent:null});
 let tree=f.render();const max=one(tree,'TokenMaximum');
 max.props.onSelect('0.'+'0'.repeat(254)+'1');tree=f.render();assert(one(tree,'TokenMaximum').props.selected);
 const amount=all(tree).find(node=>node.props.label==='Amount in T')!;
 assert.equal(amount.props.value,'0.'+'0'.repeat(254)+'1');
 if(edit){amount.props.onChange('0.'+'0'.repeat(254)+'2');tree=f.render();assert.equal(one(tree,'TokenMaximum').props.selected,false);}
 one(tree,'Screen').props.footer.props.onPress();await Promise.resolve();
 assert.equal((f.prepared[0] as unknown[])[2],'0.'+'0'.repeat(254)+(edit?'2':'1'));f.dispose();
});

function ensTicket(input: string, check: () => void, address = '0x2222222222222222222222222222222222222222') {
  const abort = new AbortController();
  const ticket: NativeRecipientResolution = { input, address, expiresAt: Date.now() + 1000, signal: abort.signal,
    assertCurrent() { check(); if(abort.signal.aborted)throw new Error('RECIPIENT_EXPIRED'); }, dispose() { abort.abort(); } };
  return { ticket, expire: () => abort.abort() };
}
const editSend = (f: ReturnType<typeof setup>, label: string, value: string) => {
  const input=all(f.render()).find(node=>node.props.label===label)!;assert(input);input.props.onChange(value);
};
const reviewSend = (f: ReturnType<typeof setup>) => one(f.render(),'Screen').props.footer.props.onPress();
const settle = () => new Promise<void>(resolve=>setImmediate(resolve));

test('ENS review and final confirmation keep the exact resolved address and name', async () => {
  let lookups=0;
  const resolver:NativeRecipientResolver={async resolve(input,_owner,_signal,check){lookups++;return ensTicket(input,check).ticket;}};
  const f=setup(undefined,undefined,resolver);f.snapshot.phase='idle';
  editSend(f,'Ethereum address','recipient.eth');editSend(f,'Amount in ETH','1');reviewSend(f);await settle();
  assert.equal((f.prepared[0] as string[])[0],'0x2222222222222222222222222222222222222222');
  const tree=f.render();const text=all(tree).flatMap(node=>node.children).join(' ');
  assert.match(text,/recipient.eth/);assert.match(text,/RESOLVED ADDRESS/);
  assert.equal(one(tree,'Text',node=>node.props.testID==='native-send-recipient').children[0],'0x2222222222222222222222222222222222222222');
  button(tree,'Confirm and send').props.onPress();authenticateSend(f);await settle();assert.deepEqual(f.confirmed,['review']);assert.equal(lookups,1);f.dispose();
});

for(const change of ['edit','account','close'] as const)test(`held ENS result cannot prepare after ${change}`,async()=>{
  let finish!:(ticket:NativeRecipientResolution)=>void,check!:()=>void;
  const resolver:NativeRecipientResolver={resolve(_input,_owner,_signal,guard){check=guard;return new Promise(resolve=>{finish=resolve;});}};
  const f=setup(undefined,undefined,resolver);f.snapshot.phase='idle';
  editSend(f,'Ethereum address','old.eth');editSend(f,'Amount in ETH','1');reviewSend(f);await Promise.resolve();
  if(change==='edit')editSend(f,'Ethereum address','0x3333333333333333333333333333333333333333');
  if(change==='account'){f.changeAccount();f.render();}
  if(change==='close')f.dispose();
  finish(ensTicket('old.eth',check).ticket);await settle();assert.equal(f.prepared.length,0);f.dispose();
});

test('expired ENS review cancels the quote and permits a fresh lookup',async()=>{
  let current!:ReturnType<typeof ensTicket>,lookups=0;
  const resolver:NativeRecipientResolver={async resolve(input,_owner,_signal,check){lookups++;current=ensTicket(input,check);return current.ticket;}};
  const f=setup(undefined,undefined,resolver);f.snapshot.phase='idle';
  editSend(f,'Ethereum address','recipient.eth');editSend(f,'Amount in ETH','1');reviewSend(f);await settle();
  const stale=button(f.render(),'Confirm and send');current.expire();stale.props.onPress();await settle();assert.equal(f.confirmed.length,0);
  reviewSend(f);await settle();assert.equal(lookups,2);assert.equal(f.prepared.length,2);f.dispose();
});

for (const edit of ['amount', 'nonce', 'controller cancellation'] as const) test(`ENS can be reviewed again after ${edit} without changing the name`, async () => {
  const tickets: NativeRecipientResolution[] = [];
  const resolver: NativeRecipientResolver = { async resolve(input, _owner, _signal, check) {
    const ticket = ensTicket(input, check).ticket; tickets.push(ticket); return ticket;
  } };
  const f = setup(undefined, undefined, resolver); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', 'recipient.eth'); editSend(f, 'Amount in ETH', '1');
  reviewSend(f); await settle();
  const staleConfirm = button(f.render(), 'Confirm and send');
  if (edit === 'controller cancellation') f.controller.cancel();
  else headerBack(f.render());
  f.render();
  assert.equal(tickets[0]!.signal.aborted, true);
  staleConfirm.props.onPress(); await settle(); assert.equal(f.confirmed.length, 0);
  if (edit === 'amount') editSend(f, 'Amount in ETH', '2');
  if (edit === 'nonce') {
    button(f.render(), 'Advanced options').props.onPress();
    editSend(f, 'Transaction nonce', '7');
  }
  reviewSend(f); await settle();
  assert.equal(tickets.length, 2); assert.equal(f.prepared.length, 2);
  assert.equal((f.prepared[1] as string[])[1], edit === 'amount' ? '2' : '1');
  if (edit === 'nonce') assert.equal((f.prepared[1] as string[])[2], '7');
  button(f.render(), 'Confirm and send').props.onPress(); authenticateSend(f); await settle();
  assert.deepEqual(f.confirmed, ['review']); f.dispose();
});

test('retiring an ENS review does not cancel its successor review or an authorized submission', async () => {
  const tickets: NativeRecipientResolution[] = [];
  const resolver: NativeRecipientResolver = { async resolve(input, _owner, _signal, check) {
    const ticket = ensTicket(input, check).ticket; tickets.push(ticket); return ticket;
  } };
  for (const authorized of [false, true]) {
    const f = setup(undefined, undefined, resolver); f.snapshot.phase = 'idle';
    editSend(f, 'Ethereum address', 'recipient.eth'); editSend(f, 'Amount in ETH', '1');
    reviewSend(f); await settle();
    if (authorized) { button(f.render(), 'Confirm and send').props.onPress(); authenticateSend(f); await settle(); }
    const cancels = f.counts().cancels;
    const successor = authorized ? null : { ...f.snapshot.review, id: 'successor' };
    f.setSnapshot({ ...f.snapshot, phase: authorized ? 'submitting' : 'review', review: successor });
    f.render();
    assert.equal(f.snapshot.review, successor); assert.equal(f.counts().cancels, cancels);
    assert.equal(tickets.at(-1)!.signal.aborted, true);
    f.dispose();
  }
});

test('unresolved ENS gives feedback without entering fee preparation',async()=>{
  const f=setup(undefined,undefined,{async resolve(){throw new Error('ENS_UNAVAILABLE');}});f.snapshot.phase='idle';
  editSend(f,'Ethereum address','missing.eth');editSend(f,'Amount in ETH','1');reviewSend(f);await settle();
  assert.equal(f.prepared.length,0);assert.match(all(f.render()).flatMap(node=>node.children).join(' '),/could not be resolved/);f.dispose();
});
