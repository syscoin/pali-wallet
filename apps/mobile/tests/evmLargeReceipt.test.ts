import assert from 'node:assert/strict';
import test from 'node:test';
import { EvmTransferReadRpc } from '../src/custody/evmTransferReadRpc.ts';
import { getNativeNetwork, type EvmNetworkId } from '../src/custody/networkContext.ts';
const hash='0x'+'1'.repeat(64),from='0x'+'2'.repeat(40),to='0x'+'3'.repeat(40),blockHash='0x'+'4'.repeat(64);
const expected={hash,from,to,nonce:'7'};
const receipt={transactionHash:hash,from,to,status:'0x1',blockNumber:'0x8',blockHash};
const largeReceipt={...receipt,logs:[{address:to,topics:[hash],data:'0x'+'ab'.repeat(10000)}]};
const json=(body:string)=>new Response(body,{headers:{'content-type':'application/json'}});
type Call={method:string;params:unknown[]};
type Stage='initial'|'repeated';
function fixture(options:{id?:EvmNetworkId;stage?:Stage;kind?:'stream'|'text'|'declared';oversized?:boolean;missing?:boolean;consumed?:boolean;receiptResponse?:(id:number)=>Response;blockResult?:(call:Call)=>unknown;onRequest?:(call:Call)=>void;chain?:(read:number)=>string;timeoutMs?:number}={}){
 const id=options.id??'ethereum',calls:Call[]=[];let receipts=0,chains=0;
 const rpc=new EvmTransferReadRpc(id,{timeoutMs:options.timeoutMs,fetch:async(_url,init)=>{
  const request=JSON.parse(String(init.body));calls.push(request);options.onRequest?.(request);let result:unknown;
  if(request.method==='eth_chainId')result=options.chain?.(++chains)??'0x'+BigInt(getNativeNetwork(id).chainId).toString(16);
  else if(request.method==='eth_getTransactionReceipt'){
   receipts++;
   if(options.receiptResponse)return options.receiptResponse(request.id);
   if(options.missing)result=null;
   else if(options.oversized!==false&&(options.stage!=='repeated'||receipts>1)){
    const body=JSON.stringify({jsonrpc:'2.0',id:request.id,result:largeReceipt});
    if(options.kind==='text')return {ok:true,headers:new Headers({'content-type':'application/json'}),body:null,text:async()=>body} as Response;
    return new Response(body,{headers:{'content-type':'application/json',...(options.kind==='declared'?{'content-length':String(body.length)}:{})}});
   }else result=receipt;
  }else if(request.method==='eth_getTransactionCount')result=options.consumed===false?'0x7':'0x8';
  else if(request.method==='eth_getBlockByNumber')result=options.blockResult?options.blockResult(request):{number:request.params[0],hash:blockHash,gasLimit:'0x1c9c380'};
  else throw Error('Unexpected RPC method');
  return json(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
 }});return {rpc,calls};
}
const signal=()=>new AbortController().signal,guard=()=>undefined;

for(const stage of ['initial','repeated'] as const)for(const kind of ['stream','text','declared'] as const)for(const consumed of [true,false])test(`${stage} oversized ${kind} receipt remains unavailable even when nonce is ${consumed?'used':'unused'}`,async()=>{
 const f=fixture({stage,kind,consumed});
 if(stage==='repeated')assert.equal((await f.rpc.receipt(expected,signal(),guard))?.status,'included');
 const before=f.calls.length;
 await assert.rejects(f.rpc.receipt(expected,signal(),guard),{code:'UNAVAILABLE'});
 assert.deepEqual(f.calls.slice(before).map(c=>c.method),['eth_chainId','eth_getTransactionReceipt']);
 assert.equal(f.calls.slice(before).some(c=>c.method==='eth_sendRawTransaction'||c.params.includes('finalized')),false);
});

for(const id of ['syscoin-nevm','zksys-testnet','base','arbitrum','rollux'] as const)test(`${id} has the same oversized-receipt failure semantics`,async()=>{
 const f=fixture({id});await assert.rejects(f.rpc.receipt(expected,signal(),guard),{code:'UNAVAILABLE'});
 assert.deepEqual(f.calls.map(c=>c.method),['eth_chainId','eth_getTransactionReceipt']);
});

test('healthy receipt canonicality retains bounded block and chain checks',async()=>{
 for(const blockResult of [()=>null,()=>({number:'0x008',hash:blockHash,gasLimit:'0x1c9c380'}),()=>({number:'0x8',hash:'bad',gasLimit:'0x1c9c380'}),()=>({number:'0x9',hash:blockHash,gasLimit:'0x1c9c380'}),()=>({number:'0x8',hash,gasLimit:'0x1c9c380'})])await assert.rejects(fixture({oversized:false,blockResult}).rpc.receipt(expected,signal(),guard));
 const wide=fixture({oversized:false,blockResult:c=>({number:c.params[0],hash:blockHash,gasLimit:'0x1c9c380',transactions:Array(300).fill(hash)})});
 assert.equal((await wide.rpc.receipt(expected,signal(),guard))?.status,'included');
 const huge=fixture({oversized:false,blockResult:()=>({number:'0x8',hash:blockHash,gasLimit:'0x1c9c380',extra:'x'.repeat(512*1024)})});
 await assert.rejects(huge.rpc.receipt(expected,signal(),guard),{code:'UNAVAILABLE'});
 await assert.rejects(fixture({oversized:false,chain:n=>n===1?'0x1':'0x2'}).rpc.receipt(expected,signal(),guard),{code:'PROFILE_CHANGED'});
});

for(const missing of [false,true])for(const mode of ['guard','abort'] as const)test(`${missing?'missing':'included'} receipt stops at every ${mode} boundary`,async()=>{
 const baseline=fixture({oversized:false,missing});await baseline.rpc.receipt(expected,signal(),guard);
 for(let stop=1;stop<=baseline.calls.length;stop++){
  let calls=0,revision=0;const controller=new AbortController();
  const f=fixture({oversized:false,missing,onRequest:()=>{if(++calls===stop){if(mode==='abort')controller.abort();else revision+=2;}}});
  await assert.rejects(f.rpc.receipt(expected,controller.signal,()=>{if(revision!==0)throw Error('stale');}),{code:'CANCELLED'});assert.equal(f.calls.length,stop);
 }
});

test('async guards never begin any RPC request',async()=>{
 const f=fixture();await assert.rejects(f.rpc.receipt(expected,signal(),async()=>undefined),{code:'CANCELLED'});assert.equal(f.calls.length,0);
});

test('small malformed replies and transport failures do not admit a receipt or nonce fallback',async()=>{
 for(const receiptResponse of [()=>{throw Error('network');},()=>json('{broken'),()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'invalid'}}),(id:number)=>json(JSON.stringify({jsonrpc:'2.0',id:id+1,result:receipt})),(id:number)=>json(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000}})),()=>new Response(new Uint8Array([0xff])),()=>new Response('offline',{status:503})]){
  const f=fixture({receiptResponse});await assert.rejects(f.rpc.receipt(expected,signal(),guard));assert.deepEqual(f.calls.map(c=>c.method),['eth_chainId','eth_getTransactionReceipt']);
 }
});

test('detached request survives caller mutation before a missing receipt uses its original nonce',async()=>{
 const input={...expected};const f=fixture({missing:true,onRequest:c=>{if(c.method==='eth_getTransactionReceipt'){input.from=to;input.nonce='999';input.hash=blockHash;}}});
 assert.deepEqual(await f.rpc.receipt(input,signal(),guard),{status:'nonce-consumed'});
 assert(f.calls.filter(c=>c.method==='eth_getTransactionCount').every(c=>c.params[0]===from&&c.params[1]==='latest'));
 assert.deepEqual(f.calls.find(c=>c.method==='eth_getTransactionReceipt')?.params,[hash]);
});
