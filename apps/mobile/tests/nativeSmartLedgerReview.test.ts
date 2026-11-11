import { resolveAssetTransferDisplay } from '../../../source/shared/assetTransferDisplay.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {screenFixture, type ScreenElement} from './screenFixture.ts';
import type {useOwnedLedgerConnection} from '../src/screens/useDappLedgerConnection';
import {formatBaseUnits} from '../src/core/amounts.ts';
import {formatTokenUnits} from '../../../source/shared/erc20.ts';
import {getNativeNetwork, getNativeSendContext} from '../src/custody/networkContext.ts';
import {guardianDelayLabel} from '../src/screens/guardianPolicyLabels.ts';
import {nativeTranslationFixture} from './localizationFixture.ts';

type Connection = ReturnType<typeof useOwnedLedgerConnection>;
function fixture() {
  let clock = 100, connected = false, closes = 0, prepares = 0;
  const authorizations: number[] = [], timers = new Set<() => void>();
  let state = {phase: 'authorize', revision: 7, intent: {kind:'deploy'}, network:getNativeNetwork('ethereum')};
  const controller = {authorizationExpiresAt:1000, getSnapshot:()=>state, subscribe:()=>()=>{},
    async prepare() {prepares++;}, async dispose() {}, async authorize(revision:number) {authorizations.push(revision);},
    async confirmPayer() {}, async retryMetadata() {}};
  const source: any = {purpose:'connect', getSnapshot:()=>({}), subscribe:()=>()=>{}, isConnected:()=>connected,
    async start() {}, async select() {}, async finishConnection() {}, async close() {closes++;}};
  const globals = {Date: class extends Date {static now(){return clock;}}, setTimeout(callback:()=>void){timers.add(callback);return callback;},clearTimeout(callback:()=>void){timers.delete(callback);}};
  const hook = screenFixture(new URL('../src/screens/useDappLedgerConnection.tsx',import.meta.url),'useOwnedLedgerConnection',{
    './NativeLedger':{NativeLedgerConnectionModal:'LedgerModal'},
  },globals);
  let connection!: Connection;
  const screen = screenFixture(new URL('../src/screens/NativeSmartAccountOperation.tsx',import.meta.url),'NativeSmartAccountOperationScreen',{
    './useDappLedgerConnection':{useOwnedLedgerConnection:(props:any)=>connection=hook.render(props) as unknown as Connection},
    '../platform/localization':nativeTranslationFixture,
    'react-native':{ActivityIndicator:'ActivityIndicator',View:'View',StyleSheet:{create:(value:unknown)=>value}},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '../ui':{colors:{},...Object.fromEntries(['Button','Card','Header','Notice','Screen','Text'].map(name=>[name,name]))},
    './NativeTransactionReview':{TransactionDetails:'TransactionDetails'},'../core/amounts':{formatBaseUnits},
    '../../../../source/shared/assetTransferDisplay': { resolveAssetTransferDisplay },
    '../../../../source/shared/erc20':{formatTokenUnits},'../custody/networkContext':{getNativeSendContext},
    './guardianPolicyLabels':{guardianDelayLabel},
  },globals);
  const render = () => screen.render({controller,ledgerConnection:source,onBack(){}});
  return {render,controller,source,authorizations, connection:()=>connection, connect(){connected=true;},
    closes:()=>closes,prepares:()=>prepares, change(phase:string,revision=state.revision){state={...state,phase,revision};},
    expire(){clock=1001;for(const callback of [...timers])callback();}, close(){screen.close();hook.close();}};
}
const picker = (state:Connection) => {assert(state.modal);return state.modal as unknown as ScreenElement;};
test('Smart operation connects before authorization, keeps consent separate, and does not block payer review after the owner proof', async () => {
  const f=fixture();try {
    let rendered=f.render();assert(rendered.props.disabled);rendered.props.authorize();assert.deepEqual(f.authorizations,[]);
    f.connection().connect();const modal=picker((f.render(),f.connection()));
    f.connect();rendered=f.render();assert(rendered.props.disabled);assert.deepEqual(f.authorizations,[]);
    modal.props.onFinished();rendered=f.render();assert(!rendered.props.disabled);assert.deepEqual(f.authorizations,[]);
    rendered.props.authorize();await Promise.resolve();assert.deepEqual(f.authorizations,[7]);
    f.change('review-fee');f.source.isConnected=()=>false;rendered=f.render();assert(!rendered.props.disabled);
    assert.equal(f.prepares(),1);
  } finally {f.close();}
});
for(const boundary of ['expiry','revision','phase','unmount'] as const) test(`Smart operation ${boundary} makes held picker/authorization callbacks inert`,async()=>{
  const f=fixture();try {
    const before=f.render();f.connection().connect();f.render();const modal=picker(f.connection()),owned=modal.props.controller;
    if(boundary==='expiry')f.expire();else if(boundary==='revision')f.change('authorize',8);else if(boundary==='phase')f.change('failed');else f.close();
    if(boundary!=='unmount')f.render();before.props.authorize();
    await assert.rejects(owned.start());await assert.rejects(owned.select('late-device'));await assert.rejects(owned.finishConnection());
    assert.deepEqual(f.authorizations,[]);assert.equal(f.closes(),1);
  } finally {f.close();}
});
