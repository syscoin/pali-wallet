import { emptyNoncePlanner } from './noncePlannerFixture.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNetwork, getNativeSendContext, getNativeSendCapabilities, NATIVE_NETWORKS, snapshotNativeNetwork, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
const owner='0x1111111111111111111111111111111111111111',recipient='0x2222222222222222222222222222222222222222';
const hash=(number:number)=>`0x${number.toString(16).padStart(64,'0')}`;
const expected={hash:hash(1),from:owner,to:recipient,nonce:'0'};
const signal=()=>new AbortController().signal;
const custom=createNativeNetwork({id:'unlisted-chain',name:'Unlisted chain',kind:'evm',chainId:'454543',slip44:60,rpcUrl:'https://custom-chain.example/rpc',symbol:'TEST',decimals:18,testnet:true});
test('network text uses the shared nonblank rule without truncating or changing padding', () => {
 const name = `  ${'Long network '.repeat(8)}🌐  `, symbol = ` ${'x'.repeat(32)} `;
 const network = createNativeNetwork({ ...custom, name, symbol });
 assert.equal(snapshotNativeNetwork(network).name, name);
 assert.equal(snapshotNativeNetwork(network).symbol, symbol);
 assert.equal(getNativeSendContext(network).name, name);
 assert.equal(getNativeSendContext(network).symbol, symbol);
 assert.throws(() => snapshotNativeNetwork({ ...network, name: name + 'changed' }), /fingerprint/);
 for (const blank of ['', ' ', '\t\n', '\u00a0']) {
  assert.throws(() => createNativeNetwork({ ...custom, name: blank }), /Invalid EVM registration/);
  assert.throws(() => createNativeNetwork({ ...custom, symbol: blank }), /Invalid EVM registration/);
 }
 for (const bad of [
  { chainId: '01' }, { chainId: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n) },
  { rpcUrl: 'http://remote.invalid' }, { rpcUrl: 'https://user:password@remote.invalid' },
  { rpcUrl: 'https://remote.invalid/#fragment' }, { rpcUrl: 'https://remote.invalid/' + 'x'.repeat(2048) },
 ]) assert.throws(() => createNativeNetwork({ ...custom, ...bad }));
});
type Call={method:string;params:any[];url:string;id:number};
function fixture(network:NativeNetworkRegistration,options:{block?:number;missing?:boolean;consumed?:boolean;update?:(call:Call,result:unknown)=>unknown;onCall?:(call:Call)=>void}={}){
 const calls:Call[]=[];const fetcher=async(url:string,init:RequestInit)=>{
  const call:Call={...JSON.parse(String(init.body)),url};calls.push(call);options.onCall?.(call);let result:unknown;
  switch(call.method){
   case 'eth_chainId':result='0x'+BigInt(network.chainId).toString(16);break;
   case 'eth_getBlockByNumber':{const n=call.params[0]==='latest'?100:Number(BigInt(call.params[0]));result={number:'0x'+n.toString(16),hash:hash(n),baseFeePerGas:'0x1',gasLimit:'0x1c9c380'};break;}
   case 'eth_getTransactionCount':result=call.params[1]==='pending'||options.consumed===false?'0x0':'0x1';break;
   case 'eth_getBalance':result='0x100000000000000000';break;
   case 'eth_gasPrice':case 'eth_maxPriorityFeePerGas':result='0x1';break;
   case 'eth_estimateGas':result='0x5208';break;
   case 'eth_getTransactionReceipt':{const n=options.block??100;result=options.missing?null:{transactionHash:expected.hash,from:owner,to:recipient,status:'0x1',blockHash:hash(n),blockNumber:'0x'+n.toString(16)};break;}
   case 'eth_sendRawTransaction':result=Transaction.from(call.params[0]).hash;break;
   default:throw Error('Unexpected RPC '+call.method);
  }
  if(options.update)result=options.update(call,result);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result}),{headers:{'content-type':'application/json'}});
 };
 return {calls,rpc:new NativeTransferRpc({registration:network,fetch:fetcher}),reader:new EvmTransferReadRpc(network,{fetch:fetcher})};
}

test('all saved EVM registrations use the same immutable context and native/token capability',()=>{
 for(const network of [...NATIVE_NETWORKS,custom]){
  assert.deepEqual(getNativeSendCapabilities(network.id, [network]),{native:true,erc20:true});
  const context=getNativeSendContext(network);assert.equal(context.chainId,network.chainId);assert.equal(context.rpcUrl,network.rpcUrl);assert.equal(context.registrationHash,network.registrationHash);
  assert.equal('settlement' in context,false);assert(Object.isFrozen(context));
  const f=fixture(network);assert.throws(()=>Object.assign(f.rpc,{context:{...context,rpcUrl:'https://wrong.invalid'}}));assert.throws(()=>Object.assign(f.rpc.context,{rpcUrl:'https://wrong.invalid'}));
 }
});

for(const network of [...NATIVE_NETWORKS,custom])test(`${network.id} quotes and broadcasts only its saved chain and endpoint`,async()=>{
 const f=fixture(network),quote=await f.rpc.prepare(owner,recipient,'1',signal(), undefined, emptyNoncePlanner);
 assert.equal(quote.transaction.chainId,network.chainId);assert(f.calls.every(c=>c.url===network.rpcUrl));
 const signer=Wallet.fromPhrase('test test test test test test test test test test test junk');
 const transaction = quote.transaction.type === 2 ? { ...quote.transaction, accessList: quote.transaction.accessList.map(entry => ({ address: entry.address, storageKeys: [...entry.storageKeys] })) } : quote.transaction;
 const raw=await signer.signTransaction({...transaction,from:signer.address,nonce:0});
 assert.equal(await f.rpc.broadcast(raw,Transaction.from(raw).hash!,signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }),Transaction.from(raw).hash);
 const bad=await signer.signTransaction({...transaction,from:signer.address,chainId:BigInt(network.chainId)+1n,nonce:0});const count=f.calls.length;
 await assert.rejects(f.rpc.broadcast(bad,Transaction.from(bad).hash!,signal(), { assertDispatchAdmission: () => undefined,  mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }),{code:'INVALID_RESPONSE'});assert.equal(f.calls.length,count);
 const mismatch=fixture(network,{update:(c,r)=>c.method==='eth_chainId'?'0x0':r});
 await assert.rejects(mismatch.rpc.prepare(owner,recipient,'1',signal(), undefined, emptyNoncePlanner),{code:'INVALID_RESPONSE'});assert.deepEqual(mismatch.calls.map(c=>c.method),['eth_chainId']);
});

for(const block of [100,99,1])test(`canonical receipt at block ${block} confirms without a minimum depth`,async()=>{
 const f=fixture(custom,{block});assert.deepEqual(await f.rpc.receipt(expected,signal()),{status:'confirmed',blockHash:hash(block),blockNumber:String(block)});
 assert.equal(f.calls.some(c=>c.method==='eth_getTransactionCount'||c.params.includes('finalized')||c.params.includes('safe')),false);
});

test('missing receipt distinguishes latest nonce use from absence without claiming success',async()=>{
 assert.deepEqual(await fixture(custom,{missing:true}).rpc.receipt(expected,signal()),{status:'nonce-consumed'});
 const f=fixture(custom,{missing:true,consumed:false});assert.equal(await f.rpc.receipt(expected,signal()),null);
 assert.deepEqual(f.calls.find(c=>c.method==='eth_getTransactionCount')?.params,[owner,'latest']);
});

test('forged identity and inconsistent canonical block still reject',async()=>{
 for(const update of [
  (c:Call,r:any)=>c.method==='eth_getTransactionReceipt'?{...r,from:recipient}:r,
  (c:Call,r:any)=>c.method==='eth_getTransactionReceipt'?{...r,to:owner}:r,
  (c:Call,r:any)=>c.method==='eth_getTransactionReceipt'?{...r,transactionHash:hash(2)}:r,
  (c:Call,r:any)=>c.method==='eth_getBlockByNumber'?{...r,hash:hash(4)}:r,
  (c:Call,r:any)=>c.method==='eth_getBlockByNumber'?{...r,number:'0x63'}:r,
 ])await assert.rejects(fixture(custom,{update}).rpc.receipt(expected,signal()),{code:'INVALID_RESPONSE'});
});

test('read ownership is checked after every standard receipt boundary',async()=>{
 for(const missing of [false,true]){
  const baseline=fixture(custom,{missing});await baseline.reader.receipt(expected,signal(),()=>undefined);
  for(let stop=1;stop<=baseline.calls.length;stop++){
   let reads=0,current=true;const f=fixture(custom,{missing,onCall:()=>{if(++reads===stop)current=false;}});
   await assert.rejects(f.reader.receipt(expected,signal(),()=>{if(!current)throw Error('changed');}),{code:'CANCELLED'});assert.equal(f.calls.length,stop);
  }
 }
});
