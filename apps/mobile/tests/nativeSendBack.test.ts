import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NativeRecipientResolver, NativeRecipientResolution } from '../src/portfolio/nativeRecipientResolver.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
function setup(token?: { contractAddress: string; decimals: number; symbol: string; name: string }, beforeClose?: () => Promise<void>, recipientResolver?: NativeRecipientResolver) {
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
  const ui={...Object.fromEntries(['Button','Card','Coin','Header','Notice','Screen','Text'].map(name=>[name,name])),colors:{},styles:{}};
  const deps: Record<string,unknown> = {
    './NativeLedger': { NativeLedgerConnectionModal: 'NativeLedgerConnectionModal' },
    './NativeTokenMaximum': { NativeTokenMaximum: 'TokenMaximum' },
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
  const prepare = async (recipient: string, amount: string, nonce?: string) => {
    prepared.push([recipient, amount, nonce]); snapshot = { ...snapshot, phase: 'review', review: {
      id: 'review', recipient, context, amountUnits: '1', maximumFeeUnits: '1', totalUnits: '2' } };
  };
  const controller={getSnapshot:()=>snapshot,subscribe:()=>()=>{},cancel(){cancels++;snapshot={...snapshot,phase:'idle',review:null};},prepare,
    async confirm(id: string) { confirmed.push(id); }, async prepareToken(...args: unknown[]) { prepared.push(args); }};
  const context={networkId:'ethereum',name:'Ethereum',symbol:'ETH',chainId:1,rpcUrl:'https://example.invalid',testnet:false};
  let account={address:'0x1111111111111111111111111111111111111111',network:'ethereum',revision:1};
  const render=()=>{cursor=0;const tree=module.exports.NativeSend({controller,context,token,beforeClose,recipientResolver,account,onBack(){backs++;}}) as Element;effects.splice(0).forEach(run=>run());return tree;};
  return {render,prepared,confirmed,get snapshot(){return snapshot;},setSnapshot(value: any){snapshot=value;},controller,
    changeAccount(){account={...account,revision:2};},hardware:()=>{assert.ok(hardware);return hardware();},counts:()=>({backs,cancels}),dispose:()=>cells.forEach(c=>c.cleanup?.())};
}
function all(node: unknown): Element[] {if(!node||typeof node!=='object'||!('children' in node))return [];const e=node as Element;return [e,...e.children.flat(Infinity).flatMap(all)];}
function one(tree:Element,type:string,predicate:(e:Element)=>boolean=()=>true) {const matches=all(tree).filter(e=>e.type===type&&predicate(e));assert.equal(matches.length,1);return matches[0]!;}
function modal(tree:Element){return one(tree,'Modal');}
function button(tree:Element,title:string){return one(tree,'Button',e=>e.props.title===title);}
function headerBack(tree:Element){one(tree,'Header').props.onBack();}

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
  button(tree,'Confirm and send').props.onPress();await settle();assert.deepEqual(f.confirmed,['review']);assert.equal(lookups,1);f.dispose();
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

test('unresolved ENS gives feedback without entering fee preparation',async()=>{
  const f=setup(undefined,undefined,{async resolve(){throw new Error('ENS_UNAVAILABLE');}});f.snapshot.phase='idle';
  editSend(f,'Ethereum address','missing.eth');editSend(f,'Amount in ETH','1');reviewSend(f);await settle();
  assert.equal(f.prepared.length,0);assert.match(all(f.render()).flatMap(node=>node.children).join(' '),/could not be resolved/);f.dispose();
});
