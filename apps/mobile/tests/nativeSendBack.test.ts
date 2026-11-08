import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
function setup(token?: { contractAddress: string; decimals: number; symbol: string; name: string }) {
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
  runInNewContext(code,{module,exports:module.exports,Error,URL,Keyboard:native.Keyboard,require(name:string){assert.ok(Object.hasOwn(deps,name),`Unexpected import ${name}`);return deps[name];}});
  let snapshot: any={phase:'submitting',review:null,hash:null,message:null,intent:null,collectible:undefined};
  const prepared: unknown[] = [];
  const controller={getSnapshot:()=>snapshot,subscribe:()=>()=>{},cancel(){cancels++;},async prepareToken(...args: unknown[]) { prepared.push(args); }};
  const context={networkId:'ethereum',name:'Ethereum',symbol:'ETH',chainId:1,rpcUrl:'https://example.invalid',testnet:false};
  const render=()=>{cursor=0;const tree=module.exports.NativeSend({controller,context,token,account:{address:'0x1111111111111111111111111111111111111111',network:'ethereum',revision:1},onBack(){backs++;}}) as Element;effects.splice(0).forEach(run=>run());return tree;};
  return {render,prepared,get snapshot(){return snapshot;},setSnapshot(value: any){snapshot=value;},controller,hardware:()=>{assert.ok(hardware);return hardware();},counts:()=>({backs,cancels}),dispose:()=>cells.forEach(c=>c.cleanup?.())};
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
