import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { Transaction } from 'ethers/transaction';
import { NativeTransferRpc } from '../src/custody/transferRpc.ts';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { snapshotUnsignedTransfer } from '../src/custody/evmFeeContracts.ts';
const from='0x1111111111111111111111111111111111111111',to='0x2222222222222222222222222222222222222222';
const hash='0x'+'a'.repeat(64),signal=()=>new AbortController().signal;
const network=createNativeNetwork({id:'review-custom',name:'Review custom chain',kind:'evm',chainId:'454544',slip44:60,rpcUrl:'https://review-custom.example/rpc',symbol:'TEST',decimals:18,testnet:true});
type Call={method:string;params:any[];url:string;id:number};
function fixture(options:{legacy?:boolean;update?:(call:Call,result:unknown)=>unknown;onCall?:(call:Call)=>void}={}){
 const calls:Call[]=[];const fetcher=async(url:string,init:RequestInit)=>{
  const c:Call={...JSON.parse(String(init.body)),url};calls.push(c);options.onCall?.(c);let r:unknown;
  switch(c.method){
   case 'eth_chainId':r='0x'+BigInt(network.chainId).toString(16);break;
   case 'eth_getBlockByNumber':r={number:c.params[0]==='latest'?'0x64':c.params[0],hash,gasLimit:'0x1c9c380',...(options.legacy?{}:{baseFeePerGas:'0x64'})};break;
   case 'eth_getTransactionCount':r='0x0';break;
   case 'eth_getBalance':r='0x10000000000000000';break;
   case 'eth_gasPrice':r='0x65';break;
   case 'eth_maxPriorityFeePerGas':r='0x0';break;
   case 'eth_estimateGas':r='0xea60';break;
   case 'eth_sendRawTransaction':r=Transaction.from(c.params[0]).hash;break;
   default:throw Error('Unexpected RPC '+c.method);
  }
  if(options.update)r=options.update(c,r);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:c.id,result:r}),{headers:{'content-type':'application/json'}});
 };
 return {calls,rpc:new NativeTransferRpc({registration:network,fetch:fetcher}),reader:new EvmTransferReadRpc(network,{fetch:fetcher})};
}

for(const legacy of [false,true])test(`${legacy?'legacy':'EIP1559'} preparation binds the exact selected fee fields before gas estimation`,async()=>{
 const f=fixture({legacy}),quote=await f.rpc.prepare(from,to,'7',signal());const estimate=f.calls.findIndex(c=>c.method==='eth_estimateGas');
 for(const method of ['eth_getTransactionCount','eth_getBalance','eth_gasPrice'])assert(f.calls.findIndex(c=>c.method===method)<estimate);
 assert.deepEqual(f.calls[estimate]!.params,[{type:legacy?'0x0':'0x2',chainId:'0x'+BigInt(network.chainId).toString(16),from,to,nonce:'0x0',value:'0x7',data:'0x',...(legacy?{gasPrice:'0x65'}:{maxFeePerGas:'0xfa',maxPriorityFeePerGas:'0x0'})},'pending']);
 assert.equal(quote.transaction.gasLimit,'72000');assert.equal(quote.maximumFeeUnits,legacy?'7272000':'18000000');assert.equal(quote.totalUnits,legacy?'7272007':'18000007');
 assert(f.calls.every(c=>c.url===network.rpcUrl));assert.equal(f.calls.some(c=>c.method==='eth_feeHistory'),false);
 const fees=await f.reader.quoteFees(quote.transaction,signal(),()=>undefined);assert.equal(fees.maximumTotalUnits,quote.totalUnits);assert.equal(fees.envelopeFeeCapUnits,quote.maximumFeeUnits);
});

test('requote preserves approved cap and zero tip rather than silently adopting suggestions',async()=>{
 const approved=(await fixture().rpc.prepare(from,to,'7',signal())).transaction;
 const next=fixture({update:(c,r)=>c.method==='eth_maxPriorityFeePerGas'?'0x32':c.method==='eth_getBlockByNumber'?{...(r as object),baseFeePerGas:'0x6e'}:r});
 const quote=await next.rpc.requote(approved,signal());assert.deepEqual(quote.transaction,approved);
 const estimate=next.calls.find(c=>c.method==='eth_estimateGas')!;assert.equal(estimate.params[0].maxFeePerGas,'0xfa');assert.equal(estimate.params[0].maxPriorityFeePerGas,'0x0');
 const increasedGas=fixture({update:(c,r)=>c.method==='eth_estimateGas'?'0x11170':r});
 await assert.rejects(increasedGas.rpc.requote(approved,signal()),{code:'REVIEW_REQUIRED'});
 const baseExceedsCap=fixture({update:(c,r)=>c.method==='eth_getBlockByNumber'?{...(r as object),baseFeePerGas:'0x100'}:r});
 await assert.rejects(baseExceedsCap.rpc.requote(approved,signal()),{code:'REVIEW_REQUIRED'});assert.equal(baseExceedsCap.calls.some(c=>c.method==='eth_estimateGas'),false);
});

test('live block gas limits, exact total, collateral and nonce remain enforced',async()=>{
 for(const gas of ['0x1c9c381','0x17d7841'])await assert.rejects(fixture({update:(c,r)=>c.method==='eth_estimateGas'?gas:r}).rpc.prepare(from,to,'1',signal()),{code:'INVALID_RESPONSE'});
 const below=await fixture({update:(c,r)=>c.method==='eth_estimateGas'?'0x17d7840':r}).rpc.prepare(from,to,'1',signal());assert.equal(below.transaction.gasLimit,'30000000');
 await assert.rejects(fixture({update:(c,r)=>c.method==='eth_getBalance'?'0x100':r}).rpc.prepare(from,to,'1',signal()),{code:'INSUFFICIENT_BALANCE'});
 const original=await fixture().rpc.prepare(from,to,'1',signal());
 await assert.rejects(fixture({update:(c,r)=>c.method==='eth_getTransactionCount'?'0x1':r}).rpc.requote(original.transaction,signal()),{code:'REVIEW_REQUIRED'});
 assert.throws(()=>snapshotUnsignedTransfer({...original.transaction,gasLimit:'9007199254740992'},network));
 const huge=fixture({update:(c,r)=>c.method==='eth_getBlockByNumber'?{...(r as object),baseFeePerGas:'0x'+'f'.repeat(64)}:r});
 await assert.rejects(huge.rpc.prepare(from,to,'1',signal()));
});

test('fee and estimation calls respect owner revocation without emitting a quote',async()=>{
 for(const method of ['eth_gasPrice','eth_maxPriorityFeePerGas','eth_estimateGas']){
  let current=true;const f=fixture({onCall:c=>{if(c.method===method)current=false;}});
  await assert.rejects(f.reader.prepare({from,to,value:'1',data:'0x'},signal(),()=>{if(!current)throw Error('revoked');}),{code:'CANCELLED'});
  assert.equal(f.calls.some(c=>c.method==='eth_sendRawTransaction'),false);
 }
});

for(const legacy of [false,true])test(`${legacy?'legacy':'type2'} broadcast preserves signed bytes and rejects another chain or unsafe gas`,async()=>{
 const signer=Wallet.fromPhrase('test test test test test test test test test test test junk'),f=fixture({legacy});
 const tx={type:legacy?0:2,chainId:BigInt(network.chainId),to,nonce:0,value:1,gasLimit:72000,...(legacy?{gasPrice:101}:{maxFeePerGas:250,maxPriorityFeePerGas:0})};
 const raw=await signer.signTransaction(tx),signed=Transaction.from(raw);assert.equal(await f.rpc.broadcast(raw,signed.hash!,signal(), { mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }),signed.hash);
 assert.deepEqual(f.calls.find(c=>c.method==='eth_sendRawTransaction')?.params,[raw]);
 for(const change of [{chainId:1n},{gasLimit:9007199254740992n}]){const bad=await signer.signTransaction({...tx,...change});const before=f.calls.length;await assert.rejects(f.rpc.broadcast(bad,Transaction.from(bad).hash!,signal(), { mode: 'new-send', admit: async (send, preflight) => { await preflight?.(); return send(); } }),{code:'INVALID_RESPONSE'});assert.equal(f.calls.length,before);}
});
