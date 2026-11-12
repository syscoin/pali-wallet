import { AUTOMATIC_FEE, snapshotEvmFeeChoice } from '../../../source/shared/transactionFeeChoice.ts';
import { parseErc20Units, encodeErc20Transfer } from '../../../source/shared/erc20.ts';
import { trezorResumeDraft } from '../src/screens/trezorResumeDraft.ts';
import type { NativeSendInitialDraft } from '../src/screens/NativeSend.tsx';
import type { SavedCollectible } from '../src/portfolio/tokenRegistry.ts';
import { Transaction } from 'ethers';
import { encodeNftTransferData } from '../../../source/shared/nftTransfer.ts';
import { languageMessages, nativeTranslationFixture } from './localizationFixture.ts';
import { createInstance } from 'i18next';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL as NodeURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import type { NativeRecipientResolver, NativeRecipientResolution } from '../src/portfolio/nativeRecipientResolver.ts';
import type { NativeUnsignedSendDraft } from '../src/screens/sendNetworkDraft.ts';
import type { NativeOperationCredential } from '../src/custody/types.ts';
import { formatBaseUnits, parseDecimalAmount } from '../src/core/amounts.ts';
import { normalizeDecimalInput } from '../../../source/shared/decimalInput.ts';
import { ASSET_STATE_SAVED_MESSAGE, ASSET_STATE_WAIT_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE } from '../src/custody/transfers.ts';

type Element = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
function setup(token?: { contractAddress: string; decimals: number; symbol: string; name: string }, beforeClose?: () => Promise<void>, recipientResolver?: NativeRecipientResolver, onChangeNetwork?: (draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>) => void, onViewTransaction?: (hash: string) => void, onChangeAsset?: (draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>, token?: unknown) => void, ledgerConnection?: { subscribe(listener: () => void): () => void; isConnected(): boolean }, localization = nativeTranslationFixture) {
  let initialDraft: NativeSendInitialDraft | undefined, collectible: SavedCollectible | undefined;
  let beforeBackup: { onRequest(draft: Extract<NativeUnsignedSendDraft, { kind: 'evm' }>): void } | undefined;
  let tokenConnections = 0;
  const tokenView = { subscribe: () => () => {}, getSnapshot: () => ({ items: [], collectibles: [] }), connect() { tokenConnections++; return () => {}; } };
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
    '../platform/localization': localization,
    '../../../../source/shared/transactionFeeChoice': { AUTOMATIC_FEE, snapshotEvmFeeChoice },
    './NetworkFeeSheet': { NetworkFeeSheet: 'NetworkFeeSheet' },
    './RecipientQrScanner': { RecipientQrScanner: 'RecipientQrScanner' },
    './SendNetworkCard': { SendNetworkCard: 'SendNetworkCard' },
    './SendAssetSelector': { SendAssetSelector: 'SendAssetSelector' },
    '../portfolio/nativePortfolio': { sameNativePortfolioAccount: (left: any, right: any) => left?.address === right?.address && left?.network === right?.network && left?.revision === right?.revision },
    './NativeLedger': { NativeLedgerConnectionModal: 'NativeLedgerConnectionModal' },
    './NativeTokenMaximum': { NativeTokenMaximum: 'TokenMaximum', nativeTokenAvailableAmount: (token: { balance?: string }) => token.balance },
    react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'../ui':ui,
    './IdleActivityBoundary':{IdlePressable:'IdlePressable',IdleTextInput:'IdleTextInput'},
    '../core/amounts':{formatBaseUnits},
    '../../../../source/shared/decimalInput': { normalizeDecimalInput },
    '../../../../source/shared/erc20':{formatTokenUnits:()=>'',parseErc20Units},
    '../../../../source/shared/evmRecipientChoices':{findLocalEvmRecipientChoices:()=>[]},
    '../../../../source/utils/nftTokenId':{normalizeNftTokenId:()=>''},
    '../custody/transfers':{ASSET_STATE_SAVED_MESSAGE, ASSET_STATE_WAIT_MESSAGE, SIGNED_STORAGE_FULL_MESSAGE, SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE},
  };
  const source=readFileSync(new NodeURL('../src/screens/NativeSend.tsx',import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const module={exports:{} as Record<string,any>};
  runInNewContext(code,{module,exports:module.exports,Error,URL,AbortController,Keyboard:native.Keyboard,require(name:string){assert.ok(Object.hasOwn(deps,name),`Unexpected import ${name}`);return deps[name];}});
  let snapshot: any={phase:'submitting',review:null,hash:null,message:null,intent:null,collectible:undefined};
  const replacementRequests: { hash: string; mode: 'cancel' | 'cancel-saved' | 'speed-up' }[] = [];
  let replacement: { hash: string; mode: 'cancel' | 'cancel-saved' | 'speed-up' } | undefined;
  const prepared: unknown[] = [];
  const confirmed: string[] = [];
  const credentials: NativeOperationCredential[] = [];
  let confirmationFailure: Error | undefined;
  let recoveryFailure: Error | undefined;
  let confirmationGate: Promise<void> | undefined, signatures = 0;
  const selectedFees: unknown[] = [];
  const prepare = async (recipient: string, amount: string, nonce?: string, feeChoice?: unknown) => {
    selectedFees.push(feeChoice); prepared.push([recipient, amount, nonce]); snapshot = { ...snapshot, phase: 'review', review: {
      id: 'review', recipient, context, amountUnits: '1', maximumFeeUnits: '1', totalUnits: '2' } };
  };
  const maximumPrepared: unknown[] = [];
  const controller={
    async prepareCancellation(hash: string) { replacementRequests.push({ hash, mode: 'cancel' }); },
    async prepareSavedCancellation(hash: string) { replacementRequests.push({ hash, mode: 'cancel-saved' }); },
    async prepareSpeedUp(hash: string) { replacementRequests.push({ hash, mode: 'speed-up' }); },
    getSnapshot:()=>snapshot,subscribe:()=>()=>{},cancel(){cancels++;snapshot={...snapshot,phase:'idle',review:null};},prepare,
    async prepareMaximum(recipient: string, nonce?: string, feeChoice?: unknown) {
      maximumPrepared.push([recipient, nonce]); await prepare(recipient, 'maximum', nonce, feeChoice);
      snapshot = { ...snapshot, review: { ...snapshot.review, amountUnits: '1999999999999937000', maximumFeeUnits: '63000', totalUnits: '2000000000000000000' } };
    },
    async confirm(id: string, credential: NativeOperationCredential) {
      const approved = snapshot.review; confirmed.push(id); credentials.push(credential);
      if (confirmationFailure) { const failure = confirmationFailure; confirmationFailure = undefined; throw failure; }
      if (confirmationGate) await confirmationGate;
      if (snapshot.review !== approved) throw Error('CANCELLED');
      signatures++;
    }, async prepareToken(...args: unknown[]) { prepared.push(args); selectedFees.push(args[4]); },
    async prepareCollectible(...args: unknown[]) { prepared.push(args); selectedFees.push(args[5]); },
    async recover() { if (recoveryFailure) throw recoveryFailure; }};
  let context={networkId:'ethereum',name:'Ethereum',symbol:'ETH',chainId:1,rpcUrl:'https://example.invalid',testnet:false,registrationHash:'ethereum-registration'};
  let account={address:'0x1111111111111111111111111111111111111111',network:'ethereum',revision:1};
  const render=()=>{cursor=0;const tree=module.exports.NativeSend({controller,context,token,collectible,initialDraft,replacement,ledgerConnection,beforeClose,beforeBackup,tokenView:beforeBackup?tokenView:undefined,recipientResolver,account,availableAmount:'2',onChangeNetwork,onChangeAsset,assetChoices:onChangeAsset?[]:undefined,onViewTransaction,onBack(){backs++;}}) as Element;effects.splice(0).forEach(run=>run());return tree;};
  return {render, selectedFees, replacementRequests, seedReplacement(value: NonNullable<typeof replacement>) { replacement = value; }, renderInput: (props: unknown) => module.exports.NativeSendInput(props) as Element,prepared,maximumPrepared,confirmed,credentials,get snapshot(){return snapshot;},setSnapshot(value: any){snapshot=value;},controller,
    requireBackup(onRequest: NonNullable<typeof beforeBackup>['onRequest']) { beforeBackup = { onRequest }; }, tokenConnections: () => tokenConnections,
    seedDraft(draft: NativeSendInitialDraft, saved?: SavedCollectible) { initialDraft = draft; collectible = saved; },
    failConfirmation(message: string) { confirmationFailure = new Error(message); },
    failRecovery(message: string) { recoveryFailure = new Error(message); },
    holdConfirmation(wait: Promise<void>) { confirmationGate = wait; }, signatures: () => signatures,
    refreshProps(){account={...account};context={...context};},
    changeNetwork(){account={...account,network:'sepolia'};context={...context,networkId:'sepolia'};},
    changeRegistration(){context={...context,registrationHash:'replacement-registration'};},
    changeAccount(){account={...account,revision:2};},hardware:()=>{assert.ok(hardware);return hardware();},counts:()=>({backs,cancels}),dispose:()=>cells.forEach(c=>c.cleanup?.())};
}
function all(node: unknown): Element[] {if(!node||typeof node!=='object'||!('children' in node))return [];const e=node as Element;return [e,...e.children.flat(Infinity).flatMap(all),...all(e.props.footer),...all(e.props.trailing)];}
function one(tree:Element,type:string,predicate:(e:Element)=>boolean=()=>true) {const matches=all(tree).filter(e=>e.type===type&&predicate(e));assert.equal(matches.length,1);return matches[0]!;}
function modal(tree:Element){return one(tree,'Modal');}
function button(tree:Element,title:string){return one(tree,'Button',e=>e.props.title===title);}
function headerBack(tree:Element){one(tree,'Header').props.onBack();}
function openRecipientScanner(f: ReturnType<typeof setup>) {
  const field = all(f.render()).find(node => node.props.label === 'Ethereum address'); assert(field);
  assert.equal(field.props.trailing.props.label, 'Scan recipient address');
  field.props.trailing.props.onPress();
  return one(f.render(), 'RecipientQrScanner');
}

for (const kind of ['native', 'token', 'ERC-721', 'ERC-1155'] as const) test(`unbacked ${kind} form hands its unsigned draft to backup without preparing or opening token custody`, () => {
  const token = kind === 'token' ? { contractAddress: '0x2222222222222222222222222222222222222222', decimals: 6, name: 'Token', symbol: 'T' } : undefined;
  const collectible = kind === 'ERC-721' || kind === 'ERC-1155' ? { contractAddress: '0x3333333333333333333333333333333333333333', tokenStandard: kind,
    ...(kind === 'ERC-1155' ? { tokenId: '7' } : {}) } as SavedCollectible : undefined;
  const f = setup(token), drafts: NativeUnsignedSendDraft[] = [];
  const draft = { recipient: '0x4444444444444444444444444444444444444444', amount: '1.25', nonce: '7', tokenId: '9', max: false, advanced: true, feeChoice: { kind: 'high' as const } };
  f.seedDraft(draft, collectible); f.snapshot.phase = 'idle'; f.requireBackup(value => drafts.push(value));
  const tree = f.render(), review = button(tree, 'Back up now');
  assert.equal(review.props.disabled, false);
  assert.equal(f.tokenConnections(), 0);
  assert.equal(one(tree, 'Button', node => node.props.icon === 'settings').props.disabled, true);
  if (token) assert.equal(one(tree, 'TokenMaximum').props.disabled, true);
  review.props.onPress();
  assert.equal(JSON.stringify(drafts), JSON.stringify([{ kind: 'evm', ...draft }]));
  assert.deepEqual(f.prepared, []); assert.deepEqual(f.maximumPrepared, []); assert.deepEqual(f.confirmed, []);
  assert.equal(f.tokenConnections(), 0); f.dispose();
});

test('device authorization refusal keeps the exact EVM review available for retry', async () => {
  const f = setup(); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
  const review = f.snapshot.review;
  f.failConfirmation('DEVICE_UNLOCK_UNAVAILABLE');
  button(f.render(), 'Confirm and send').props.onPress(); await settle();
  assert.strictEqual(f.snapshot.review, review);
  assert.equal(f.signatures(), 0); assert.equal(f.confirmed.length, 1);
  assert(all(f.render()).some(node => node.props.accessibilityRole === 'alert'));
  button(f.render(), 'Confirm and send').props.onPress(); await settle();
  assert.deepEqual(f.credentials.map(value => value.method), ['device', 'device']);
  assert.equal(f.signatures(), 1); f.dispose();
});

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

test('French saved-state and capacity notices keep raw controller identity and suppress duplicate errors', async () => {
  const i18n = createInstance();
  await i18n.init({ initImmediate: false, lng: 'fr', fallbackLng: 'en',
    resources: { fr: { translation: languageMessages('fr') }, en: { translation: languageMessages('en') } },
    interpolation: { escapeValue: false } });
  const localization = { nativeI18n: i18n, useNativeTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) };
  for (const [message, failure, titleKey, bodyKey] of [
    [ASSET_STATE_SAVED_MESSAGE, 'EXPIRED', 'savedNotSubmitted', 'asset_state_saved_message'],
    [SIGNED_STORAGE_FULL_PREVIOUS_MESSAGE, 'SIGNED_STORAGE_FULL', 'checkEarlierTransaction', 'signed_storage_full_previous_message'],
  ] as const) {
    const f = setup(undefined, undefined, undefined, undefined, undefined, undefined, undefined, localization);
    try {
      f.setSnapshot({ ...f.snapshot, phase: 'unknown', hash: '0xsaved', message });
      const translated = i18n.t(`mobile.sendAssetViews.evm.${bodyKey}`);
      assert.notEqual(translated, message);
      let tree = f.render();
      assert(all(tree).some(node => node.children.includes(i18n.t(`mobile.sendAssetViews.evm.${titleKey}`))));
      assert(one(tree, 'View', node => node.props.accessibilityRole === 'alert'));
      assert.equal(one(tree, 'Notice').props.body, translated);
      f.failRecovery(failure);
      button(tree, i18n.t('settings.smartAccountInfrastructureCheckStatus')).props.onPress(); await settle();
      tree = f.render();
      assert.equal(f.snapshot.message, message, 'translation must not change model identity');
      assert.equal(one(tree, 'Notice').props.body, translated);
      assert.equal(all(tree).filter(node => node.type === 'Text' && node.props.accessibilityRole === 'alert').length, 0,
        'the saved-state notice supplies the single error explanation');
    } finally { f.dispose(); }
  }
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
  assert.equal(f.render().type, 'RecipientQrScanner');
  scanner.props.onScan('0x2222222222222222222222222222222222222222');
  const tree = f.render();
  assert.equal(all(tree).find(node => node.props.label === 'Ethereum address')!.props.value, '0x2222222222222222222222222222222222222222');
  assert.equal(all(tree).find(node => node.props.label === 'Amount in ETH')!.props.value, '0.25');
  assert.deepEqual(f.prepared, []); assert.deepEqual(f.confirmed, []);
  assert.equal(all(tree).some(node => node.type === 'RecipientQrScanner'), false); f.dispose();
});

for (const action of ['hardware', 'header', 'scanner'] as const) test(`${action} Back closes the EVM scanner before leaving its unchanged draft`, () => {
  const f = setup(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Ethereum address', '0x3333333333333333333333333333333333333333');
    editSend(f, 'Amount in ETH', '0.25');
    const header = one(f.render(), 'Header');
    const scanner = openRecipientScanner(f), before = f.counts();
    assert.equal(f.render().type, 'RecipientQrScanner');
    if (action === 'hardware') assert.equal(f.hardware(), true);
    else if (action === 'header') header.props.onBack();
    else scanner.props.onClose();
    scanner.props.onScan('0x2222222222222222222222222222222222222222');
    const tree = f.render();
    assert.equal(all(tree).find(node => node.props.label === 'Ethereum address')!.props.value, '0x3333333333333333333333333333333333333333');
    assert.equal(all(tree).find(node => node.props.label === 'Amount in ETH')!.props.value, '0.25');
    assert.deepEqual(f.counts(), before);
    assert.deepEqual(f.prepared, []); assert.deepEqual(f.confirmed, []);
    f.hardware();
    assert.deepEqual(f.counts(), { backs: before.backs + 1, cancels: before.cancels + 1 });
  } finally { f.dispose(); }
});

test('recipient scan survives equal account and network props from a balance refresh', () => {
  const f = setup(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Amount in ETH', '0.25');
    const scanner = openRecipientScanner(f);
    f.refreshProps();
    assert(all(f.render()).some(node => node.type === 'RecipientQrScanner'));
    scanner.props.onScan('0x2222222222222222222222222222222222222222');
    const tree = f.render();
    assert.equal(all(tree).find(node => node.props.label === 'Ethereum address')!.props.value, '0x2222222222222222222222222222222222222222');
    assert.equal(all(tree).find(node => node.props.label === 'Amount in ETH')!.props.value, '0.25');
    assert(!all(tree).some(node => node.type === 'RecipientQrScanner'));
    assert.deepEqual(f.prepared, []); assert.deepEqual(f.confirmed, []);
  } finally { f.dispose(); }
});

for (const boundary of ['close', 'account', 'network', 'registration', 'draft', 'review'] as const) test(`recipient scan cannot fill after ${boundary} changes`, () => {
  const f = setup(); f.snapshot.phase = 'idle';
  const amount = all(f.render()).find(node => node.props.label === 'Amount in ETH')!;
  const scanner = openRecipientScanner(f);
  if (boundary === 'close') scanner.props.onClose();
  if (boundary === 'account') { f.changeAccount(); f.render(); }
  if (boundary === 'network') { f.changeNetwork(); f.render(); }
  if (boundary === 'registration') { f.changeRegistration(); f.render(); }
  if (boundary === 'draft') amount.props.onChange('0.5');
  if (boundary === 'review') f.setSnapshot({ ...f.snapshot, phase: 'review', review: {} });
  scanner.props.onScan('0x2222222222222222222222222222222222222222');
  scanner.props.onClose();
  if (boundary === 'review') f.setSnapshot({ ...f.snapshot, phase: 'idle', review: null });
  assert.equal(all(f.render()).find(node => node.props.label === 'Ethereum address')!.props.value, '');
  assert.deepEqual(f.prepared, []); f.dispose();
});

test('draft network card exposes Change only when the parent provides it', () => {
  let changes = 0;
  const f = setup(undefined, undefined, undefined, () => { changes++; }); f.snapshot.phase = 'idle';
  const network = one(f.render(), 'SendNetworkCard');
  assert.equal(network.props.context.name, 'Ethereum');
  openRecipientScanner(f); network.props.onChange();
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

test('asset selector captures same-network unsigned text without preparing or authorizing', () => {
  const captured: unknown[] = [];
  const f = setup(undefined, undefined, undefined, undefined, undefined, (draft, token) => captured.push([draft, token])); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '1.5');
  const asset = { contractAddress: '0x' + 'ab'.repeat(20), name: 'Saved token', symbol: 'TOK', decimals: 6 };
  one(f.render(), 'SendAssetSelector').props.onSelect(asset);
  assert.equal((captured[0] as any[])[0].recipient, '0x2222222222222222222222222222222222222222');
  assert.equal((captured[0] as any[])[1], asset); assert.deepEqual(f.prepared, []); assert.deepEqual(f.confirmed, []); f.dispose();
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

test('send review directly requests device authorization once without a local PIN page', async () => {
  const f = setup(), held = Promise.withResolvers<void>(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
    editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
    const review = f.snapshot.review;
    f.holdConfirmation(held.promise);
    const confirm = button(f.render(), 'Confirm and send'); confirm.props.onPress(); confirm.props.onPress();
    assert.deepEqual(f.confirmed, ['review']); assert.deepEqual(f.credentials.map(value => value.method), ['device']);
    assert.equal(f.signatures(), 0); assert.strictEqual(f.snapshot.review, review);
    assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
    held.resolve(); await settle(); assert.equal(f.signatures(), 1);
  } finally { held.resolve(); f.dispose(); }
});

test('confirmation captured for a replaced review cannot authorize its successor', async () => {
  const f = setup(); f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
  const confirm = button(f.render(), 'Confirm and send');
  f.setSnapshot({ ...f.snapshot, review: { ...f.snapshot.review } }); f.render();
  confirm.props.onPress(); await settle();
  assert.deepEqual(f.confirmed, []); f.dispose();
});

test('Back during device authorization cancels the controller and discards its late outcome', async () => {
  const f = setup(), held = Promise.withResolvers<void>(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
    editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
    f.holdConfirmation(held.promise); button(f.render(), 'Confirm and send').props.onPress();
    assert.equal(f.confirmed.length, 1); assert.equal(button(f.render(), 'Confirm and send').props.disabled, true);
    headerBack(f.render());
    assert.equal(f.counts().cancels, 1); assert.equal(f.snapshot.review, null);
    held.resolve(); await settle();
    assert.equal(f.signatures(), 0);
    assert.equal(all(f.render()).some(node => node.props.accessibilityRole === 'alert'), false);
  } finally { held.resolve(); f.dispose(); }
});

test('signing and submitting keep submission Back behind the existing Leave prompt', async () => {
  const f = setup(), held = Promise.withResolvers<void>(); f.snapshot.phase = 'idle';
  try {
    editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
    editSend(f, 'Amount in ETH', '1'); reviewSend(f); await settle();
    f.holdConfirmation(held.promise); button(f.render(), 'Confirm and send').props.onPress();
    f.snapshot.phase = 'signing';
    assert.equal(all(f.render()).some(node => node.type === 'TransactionAuthentication'), false);
    f.snapshot.phase = 'submitting'; const tree = f.render();
    assert.equal(f.counts().cancels, 0);
    headerBack(tree); assert.equal(modal(f.render()).props.visible, true);
    assert(button(f.render(), 'Stay')); assert(button(f.render(), 'Leave'));
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
  button(f.render(), 'Confirm and send').props.onPress();  await settle();
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
    if (authorized) { button(f.render(), 'Confirm and send').props.onPress();  await settle(); }
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

test('native coin MAX is inline, selects the dedicated review, and editing returns to fixed amount', async () => {
  const f = setup();
  f.snapshot.phase = 'idle';
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  const amount = all(f.render()).find(node => node.props.label === 'Amount in ETH');
  assert(amount);
  assert.equal(amount.props.trailing.props.title, 'MAX');
  amount.props.trailing.props.onPress();
  assert.equal(button(f.render(), 'MAX selected').props.disabled, false);
  assert.equal(all(f.render()).find(node => node.props.label === 'Amount in ETH')!.props.value, '2');
  reviewSend(f); await settle();
  assert.deepEqual(f.maximumPrepared, [['0x2222222222222222222222222222222222222222', undefined]]);
  assert.equal(one(f.render(), 'Text', node => node.props.testID === 'native-send-amount').children[0], '1.999999999999937');
  f.controller.cancel(); f.render();
  editSend(f, 'Amount in ETH', '0.5');
  assert.equal(button(f.render(), 'MAX').props.disabled, false);
  reviewSend(f); await settle();
  assert.deepEqual(f.prepared.at(-1), ['0x2222222222222222222222222222222222222222', '0.5', undefined]);
  f.dispose();
});


test('ERC20 review hero retains the reviewed token identity and symbol fallback', () => {
  const token = { contractAddress: '0x' + 'ab'.repeat(20), decimals: 6, name: 'Saved token', symbol: 'TOK' };
  const f = setup(token);
  try {
    f.setSnapshot({ ...f.snapshot, phase: 'review', review: {
      id: 'token-review', recipient: '0x' + '2'.repeat(40), amountUnits: '2500000', maximumFeeUnits: '1', totalUnits: '1',
      context: { networkId: 'ethereum', name: 'Ethereum', symbol: 'ETH', chainId: '1', rpcUrl: 'https://example.invalid', testnet: false, registrationHash: 'reviewed-registration' },
      intent: { token },
    } });
    const hero = one(f.render(), 'Coin', node => node.props.size === 46);
    assert.deepEqual(JSON.parse(JSON.stringify(hero.props.asset)), {
      kind: 'evm', chainId: '1', contractAddress: token.contractAddress, decimals: token.decimals,
    });
    assert.equal(hero.props.registrationHash, 'reviewed-registration');
    assert.equal(hero.props.fallbackSymbol, 'TOK');
  } finally { f.dispose(); }
});


test('Smart replacement confirmation follows the retained payer connection requirement', async () => {
  let payerConnected = false;
  const f = setup(undefined, undefined, undefined, undefined, undefined, undefined, {
    subscribe: () => () => undefined, isConnected: () => payerConnected,
  });
  try {
    await f.controller.prepare('0x2222222222222222222222222222222222222222', '1');
    f.setSnapshot({ ...f.snapshot, review: { ...f.snapshot.review,
      replacement: { mode: 'speed-up', originalHash: '0xoriginal', originalMaximumFeeUnits: '1' },
      execution: { kind: 'contract-call', dataBytes: 4, accessListEntries: 0, smartAccount: '0x3333333333333333333333333333333333333333' },
    } });
    assert(button(f.render(), 'Submit Speed Up').props.disabled, 'an actual Ledger payer must connect before confirmation');
    button(f.render(), 'Submit Speed Up').props.onPress(); await settle();
    assert.equal(f.confirmed.length, 0);
    // The runtime reports connected with empty targets for a retained software/Trezor payer.
    payerConnected = true;
    assert(!button(f.render(), 'Submit Speed Up').props.disabled);
    assert.equal(all(f.render()).some(node => node.props.title === 'Connect Ledger'), false);
    button(f.render(), 'Submit Speed Up').props.onPress(); await settle();
    assert.deepEqual(f.confirmed, ['review']);
  } finally { f.dispose(); }
});

test('shared decimal input normalizes locale commas only for decimal fields', async () => {
  const i18n = createInstance();
  await i18n.init({ initImmediate: false, lng: 'fr', fallbackLng: false,
    resources: { fr: { translation: languageMessages('fr') } }, interpolation: { escapeValue: false } });
  const localization = { nativeI18n: i18n, useNativeTranslation: () => ({ t: i18n.t.bind(i18n), i18n }) };
  const f = setup(undefined, undefined, undefined, undefined, undefined, undefined, undefined, localization);
  const values: string[] = [];
  try {
    const input = (keyboardType: string) => one(f.renderInput({ label: 'Amount', value: '', busy: false,
      onChange: (value: string) => values.push(value), keyboardType }), 'IdleTextInput');
    input('decimal-pad').props.onChangeText('0,25');
    assert.equal(values.at(-1), '0.25');
    assert.equal(parseDecimalAmount(values.at(-1)!, 18), 250000000000000000n);
    input('decimal-pad').props.onChangeText('1.234,56');
    assert.equal(values.at(-1), '1.234,56');
    assert.throws(() => parseDecimalAmount(values.at(-1)!, 18));
    input('decimal-pad').props.onChangeText('0,');
    assert.equal(values.at(-1), '0.');
    input('number-pad').props.onChangeText('1,2');
    assert.equal(values.at(-1), '1,2');
    input('default').props.onChangeText('name,example');
    assert.equal(values.at(-1), 'name,example');
  } finally { f.dispose(); }
});

test('EVM available balance accessibility retains the exact value and unit', () => {
  const f = setup();
  try {
    f.snapshot.phase = 'idle';
    assert(one(f.render(), 'Text', node => node.props.accessibilityLabel === 'Available 2 ETH'));
  } finally { f.dispose(); }
});


test('fee choice retires prior consent and preserves MAX for a fresh quote', async () => {
  const f = setup(); f.snapshot.phase = 'idle'; f.render();
  editSend(f, 'Ethereum address', '0x2222222222222222222222222222222222222222');
  button(f.render(), 'MAX').props.onPress();
  button(f.render(), 'Network Fee · Automatic').props.onPress();
  const sheet = one(f.render(), 'NetworkFeeSheet');
  sheet.props.onApply({ kind: 'custom', type: 2, maxFeePerGas: '7000000000', maxPriorityFeePerGas: '1000000000' });
  assert(f.counts().cancels > 0); assert.equal(f.snapshot.review, null);
  reviewSend(f); await settle();
  assert.equal(f.maximumPrepared.length, 1);
  assert.equal((f.selectedFees[0] as any).maxFeePerGas, '7000000000');
  f.dispose();
});

for (const kind of ['native', 'erc20', 'nft'] as const) test(`Trezor ${kind} return preserves custom gas and fees in the actual send form`, async () => {
  const recipient = '0x2222222222222222222222222222222222222222';
  const from = '0x1111111111111111111111111111111111111111';
  const token = { contractAddress: '0x3333333333333333333333333333333333333333', name: 'Token', symbol: 'TOK', decimals: 18 };
  const intent = kind === 'erc20' ? { kind: 'erc20-transfer' as const, chainId: '1', recipient, amountUnits: '1000000000000000000', token }
    : kind === 'nft' ? { kind: 'nft-transfer' as const, chainId: '1', from, recipient, contractAddress: token.contractAddress,
      tokenStandard: 'ERC-1155' as const, tokenId: '7', amountUnits: '1' } : undefined;
  const unsignedTransaction = Transaction.from({ type: 2, chainId: 1, nonce: 7, gasLimit: 65000,
    maxFeePerGas: 7_000_000_000, maxPriorityFeePerGas: 1_000_000_000,
    to: intent ? token.contractAddress : recipient, value: intent ? 0 : 1_000_000_000_000_000_000n,
    data: intent?.kind === 'erc20-transfer' ? encodeErc20Transfer(recipient, intent.amountUnits)
      : intent ? encodeNftTransferData(intent) : '0x' }).unsignedSerialized;
  const resumed = trezorResumeDraft({ id: 'resume', kind: 'evm', accountId: 'trezor:60:0', networkId: 'ethereum', unsignedTransaction, ...(intent ? { intent } : {}) });
  if (resumed.kind === 'utxo') throw Error('Unexpected UTXO draft');
  const f = setup(kind === 'erc20' ? token : undefined);
  try {
    f.seedDraft(resumed.draft, resumed.kind === 'collectible' ? resumed.collectible : undefined);
    f.snapshot.phase = 'idle'; f.render();
    assert(button(f.render(), 'Network Fee · Custom'));
    reviewSend(f); await settle();
    assert.deepEqual(f.selectedFees, [{ kind: 'custom', type: 2, gasLimit: '65000', maxFeePerGas: '7000000000', maxPriorityFeePerGas: '1000000000' }]);
    assert.equal(f.prepared.length, 1); assert.equal(f.signatures(), 0);
  } finally { f.dispose(); }
});

for (const operation of ['speed-up', 'cancel', 'cancel-saved'] as const) test(`Trezor ${operation} continuation opens only the fresh retained-hash replacement path`, async () => {
  const originalHash = '0x' + 'ab'.repeat(32);
  const unsignedTransaction = Transaction.from({ type: 2, chainId: 1, nonce: 7,
    to: operation === 'speed-up' ? null : '0x' + '11'.repeat(20),
    data: operation === 'speed-up' ? '0x6001600055' : '0x',
    value: 0, gasLimit: 50000, maxFeePerGas: 9, maxPriorityFeePerGas: 1 }).unsignedSerialized;
  const resumed = trezorResumeDraft({ id: 'resume', kind: 'evm', accountId: 'trezor:60:0', networkId: 'ethereum',
    unsignedTransaction, replacement: { operation, originalHash } });
  assert.equal(resumed.kind, 'replacement');
  if (resumed.kind !== 'replacement') return;
  const f = setup();
  try {
    f.seedDraft(resumed.draft);
    f.seedReplacement({ hash: resumed.replacement.originalHash, mode: resumed.replacement.operation });
    f.snapshot.phase = 'idle'; f.render(); await settle();
    assert.deepEqual(f.replacementRequests, [{ hash: originalHash, mode: operation }]);
    assert.deepEqual(f.prepared, []); assert.deepEqual(f.maximumPrepared, []);
    assert.deepEqual(f.confirmed, []); assert.equal(f.signatures(), 0);
    headerBack(f.render());
    assert(f.counts().cancels > 0);
    assert.equal(f.signatures(), 0);
  } finally { f.dispose(); }
});
