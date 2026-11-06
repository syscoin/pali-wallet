import assert from 'node:assert/strict';
import test from 'node:test';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNetwork, getNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from '../src/custody/networkContext.ts';
import type { EvmUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
const from = Wallet.fromPhrase('test test test test test test test test test test test junk').address;
const to = '0x1111111111111111111111111111111111111111';
const hash = '0x' + '1'.repeat(64), blockHash = '0x' + '2'.repeat(64);
const custom = createNativeNetwork({ id:'custom-fee-chain',name:'Custom fee chain',kind:'evm',chainId:'454545',slip44:60,rpcUrl:'https://custom-fee.example/rpc',symbol:'TEST',decimals:18,testnet:true });
const transaction = (network: NativeNetworkRegistration = getNativeNetwork('ethereum')): EvmUnsignedTransfer => ({ type: 2, from, to, chainId:network.chainId, nonce:'0',value:'100',gasLimit:'21000',data:'0x',maxFeePerGas:'10',maxPriorityFeePerGas:'2' });
const request={hash,from,to,nonce:'0'};
const signal=()=>new AbortController().signal;
type Call={method:string;params:unknown[];signal:AbortSignal};
function fixture(network=getNativeNetwork('ethereum'), override?:(call:Call)=>unknown|Promise<unknown>){
 const calls:Call[]=[];
 const rpc=new EvmTransferReadRpc(network,{monotonicMilliseconds:()=>1000,fetch:async(url,init)=>{
  assert.equal(url,network.rpcUrl);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  const body=JSON.parse(String(init.body));const call={...body,signal:init.signal} as Call;calls.push(call);
  const inspect=(value:unknown):void=>{if(Array.isArray(value))value.forEach(inspect);else if(value&&typeof value==='object')Object.values(value).forEach(inspect);else if(typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value)){let tx:Transaction|undefined;try{tx=Transaction.from(value)}catch{/* Not a transaction. */}assert.equal(tx?.isSigned()??false,false);}};
  inspect(body.params);assert.notEqual(call.method,'eth_sendRawTransaction');
  let result=override?await override(call):undefined;
  if(result===undefined){
   if(call.method==='eth_chainId')result='0x'+BigInt(network.chainId).toString(16);
   else if(call.method==='eth_getBlockByNumber')result={number:call.params[0]==='latest'?'0x64':call.params[0],hash:blockHash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380'};
   else if(call.method==='eth_estimateGas')result='0x5208';
   else if(call.method==='eth_getTransactionCount')result='0x1';
   else if(call.method==='eth_getBalance')result='0xffffffffffff';
   else if(call.method==='eth_getTransactionReceipt')result={transactionHash:hash,from,to,status:'0x1',blockNumber:'0x50',blockHash};
   else throw Error('Unexpected read method '+call.method);
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'content-type':'application/json'}});
 }});return {rpc,calls};
}

for(const network of [...NATIVE_NETWORKS,custom])test(`${network.id} quotes the same exact unsigned envelope without chain profiles`,async()=>{
 const f=fixture(network),quote=await f.rpc.quoteFees(transaction(network),signal(),()=>undefined);
 assert.equal(quote.envelopeFeeCapUnits,'210000');assert.equal(quote.estimatedFeeUnits,'126000');assert.equal(quote.fundingEstimateUnits,'210100');assert.equal(quote.maximumTotalUnits,'210100');
 assert.equal(f.calls.filter(c=>c.method==='eth_estimateGas').length,1);
 assert.deepEqual(f.calls.find(c=>c.method==='eth_estimateGas')!.params,[{from,to,data:'0x',value:'0x64',maxFeePerGas:'0xa',maxPriorityFeePerGas:'0x2',type:'0x2',chainId:'0x'+BigInt(network.chainId).toString(16),nonce:'0x0'},'pending']);
 assert.equal(f.calls.some(c=>['eth_call','eth_getCode','eth_getStorageAt'].includes(c.method)||c.params.includes('finalized')),false);
});

test('input snapshots survive mutation and A-B-A/async guards reject stale quote work',async()=>{
 const input={...transaction()};const f=fixture(undefined,c=>{if(c.method==='eth_chainId')input.value='999';});
 assert.equal((await f.rpc.quoteFees(input,signal(),()=>undefined)).fundingEstimateUnits,'210100');
 let revision=0;const changed=fixture(undefined,c=>{if(c.method==='eth_getBlockByNumber')revision+=2;});
 await assert.rejects(changed.rpc.quoteFees(transaction(),signal(),()=>{if(revision!==0)throw Error('changed');}),{code:'CANCELLED'});
 const invalid=fixture();await assert.rejects(invalid.rpc.quoteFees(transaction(),signal(),async()=>undefined),{code:'CANCELLED'});assert.equal(invalid.calls.length,0);
});

test('wrong chain, changed block, gas growth and underpriced envelope still reject',async()=>{
 for(const [override,code] of [
  [(c:Call)=>c.method==='eth_chainId'?'0x2':undefined,'PROFILE_CHANGED'],
  [(c:Call)=>c.method==='eth_getBlockByNumber'&&c.params[0]==='0x64'?{number:'0x64',hash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380'}:undefined,'PROFILE_CHANGED'],
  [(c:Call)=>c.method==='eth_getBlockByNumber'?{number:'0x64',hash,baseFeePerGas:'0xb',gasLimit:'0x1c9c380'}:undefined,'REVIEW_REQUIRED'],
  [(c:Call)=>c.method==='eth_estimateGas'?'0x5209':undefined,'REVIEW_REQUIRED'],
 ] as const)await assert.rejects(fixture(undefined,override).rpc.quoteFees(transaction(),signal(),()=>undefined),{code});
});

for(const network of [getNativeNetwork('ethereum'),getNativeNetwork('syscoin-nevm'),getNativeNetwork('zksys-testnet'),custom])test(`${network.id} confirms ordinary canonical inclusion without a settlement gate`,async()=>{
 const f=fixture(network),result=await f.rpc.receipt(request,signal(),()=>undefined);
 assert.deepEqual(result,{status:'included',outcome:'succeeded',canonicalObserved:true,block:{number:'80',hash:blockHash}});
 assert.equal(f.calls.some(c=>c.method==='eth_getTransactionCount'||c.params.includes('safe')||c.params.includes('finalized')),false);
});

test('orphan receipts reject and nonce consumption alone never claims execution',async()=>{
 await assert.rejects(fixture(undefined,c=>c.method==='eth_getBlockByNumber'?{number:'0x50',hash,gasLimit:'0x1c9c380'}:undefined).rpc.receipt(request,signal(),()=>undefined),{code:'PROFILE_CHANGED'});
 const missing=fixture(undefined,c=>c.method==='eth_getTransactionReceipt'?null:undefined);
 assert.deepEqual(await missing.rpc.receipt(request,signal(),()=>undefined),{status:'nonce-consumed'});
 assert(missing.calls.some(c=>c.method==='eth_getTransactionCount'&&c.params[1]==='latest'));
 const unconsumed=fixture(undefined,c=>c.method==='eth_getTransactionReceipt'?null:c.method==='eth_getTransactionCount'?'0x0':undefined);
 assert.equal(await unconsumed.rpc.receipt(request,signal(),()=>undefined),null);
});

test('each canonical receipt read boundary rejects revoked authority',async()=>{
 const baseline=fixture();await baseline.rpc.receipt(request,signal(),()=>undefined);
 for(let stop=1;stop<=baseline.calls.length;stop++){
  let seen=0,current=true;const f=fixture(undefined,()=>{if(++seen===stop)current=false;});
  await assert.rejects(f.rpc.receipt(request,signal(),()=>{if(!current)throw Error('revoked');}),{code:'CANCELLED'});
  assert.equal(f.calls.length,stop);
 }
});

test('separate bounded block responses preserve ordinary response caps',async()=>{
 const wide=fixture(undefined,c=>c.method==='eth_getBlockByNumber'?{number:c.params[0]==='latest'?'0x64':c.params[0],hash:blockHash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380',transactions:Array(400).fill(hash)}:undefined);
 assert.equal((await wide.rpc.quoteFees(transaction(),signal(),()=>undefined)).maximumTotalUnits,'210100');
 const huge=fixture(undefined,c=>c.method==='eth_getBlockByNumber'?{number:'0x64',hash,baseFeePerGas:'0x4',gasLimit:'0x1c9c380',padding:'a'.repeat(512*1024)}:undefined);
 await assert.rejects(huge.rpc.quoteFees(transaction(),signal(),()=>undefined),{code:'UNAVAILABLE'});
 const ordinary=fixture(undefined,c=>c.method==='eth_chainId'?'0x'+'1'.repeat(17000):undefined);
 await assert.rejects(ordinary.rpc.quoteFees(transaction(),signal(),()=>undefined),{code:'UNAVAILABLE'});
});

test('aborted input emits no request and malformed RPC envelopes never become fees',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.rpc.quoteFees(transaction(),controller.signal,()=>undefined),{code:'CANCELLED'});assert.equal(f.calls.length,0);
 const rpc=new EvmTransferReadRpc(custom,{fetch:async(_url,init)=>{const body=JSON.parse(String(init.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'unavailable'}}));}});
 await assert.rejects(rpc.quoteFees(transaction(custom),signal(),()=>undefined),{code:'INVALID_RESPONSE'});
});

for (const legacy of [false, true]) test(`approved native requote uses raw gas within the original margin (legacy=${legacy})`, async () => {
 let estimate = 21000;
 let blockGasLimit = 25200;
 const f = fixture(custom, call => {
  if (call.method === 'eth_getBlockByNumber') return {
   number: call.params[0] === 'latest' ? '0x64' : call.params[0],
   hash: blockHash, gasLimit: '0x' + blockGasLimit.toString(16), ...(legacy ? {} : { baseFeePerGas: '0x4' }),
  };
  if (call.method === 'eth_estimateGas') return '0x' + estimate.toString(16);
  if (call.method === 'eth_gasPrice') return '0xa';
  if (call.method === 'eth_maxPriorityFeePerGas') return '0x2';
  return undefined;
 });
 const input = { from, to, value: '100', data: '0x' };
 const quote = await f.rpc.prepare(input, signal(), () => undefined);
 assert.equal(quote.transaction.gasLimit, '25200');
 assert.equal(quote.transaction.type, legacy ? 0 : 2);
 for (estimate of [21000, 22000, 25200]) {
  const refreshed = await f.rpc.prepare(input, signal(), () => undefined, quote.transaction);
  assert.deepEqual(refreshed.transaction, quote.transaction);
  assert.equal(refreshed.maximumFeeUnits, quote.maximumFeeUnits);
 }
 blockGasLimit = 30000;
 estimate = 25201;
 await assert.rejects(f.rpc.prepare(input, signal(), () => undefined, quote.transaction), {
  code: 'REVIEW_REQUIRED',
 });
});
