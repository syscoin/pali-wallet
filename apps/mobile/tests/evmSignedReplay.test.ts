import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, Transaction } from 'ethers';
import { EvmSignedRecords } from '../../../source/wallet/evmSignedRecords.ts';
import { EvmSignedReplay } from '../../../source/wallet/evmSignedReplay.ts';
import { observeEvmTransaction } from '../../../source/shared/evmTransactionObservation.ts';
import { signedRecordTestSession } from './signedRecordTestSession.ts';
const wallet = new Wallet('0x'+'11'.repeat(32));
const recipient = '0x'+'22'.repeat(20), blockHash='0x'+'33'.repeat(32);
async function fixture() {
  let raw: string | undefined, clock=10, revoked=false, nonce=0, lost=false;
  const receipts = new Map<string, any>(), dispatched:string[]=[], calls:string[]=[];
  const port={async read(){return raw;},async compareAndSet(_profile:string,before:string|undefined,next:string,check:()=>void){check();if(raw!==before)return false;raw=next;return true;}};
  const session=signedRecordTestSession(()=>{if(revoked)throw Error('revoked');});
  const records=new EvmSignedRecords(port,()=>1000);
  const context={account:{id:0,type:'HDAccount',address:wallet.address},network:{kind:'ethereum',chainId:7654321,slip44:60,url:'https://offline.invalid'}};
  const read=async(method:string,params:readonly unknown[])=>{
    calls.push(method);
    if(method==='eth_chainId')return '0x74cbb1';
    if(method==='eth_getTransactionCount')return '0x'+nonce.toString(16);
    if(method==='eth_getTransactionReceipt')return receipts.get(params[0] as string)??null;
    if(method==='eth_getBlockByNumber')return {number:'0xa',hash:blockHash,gasLimit:'0x1c9c380'};
    throw Error(method);
  };
  const create=()=>new EvmSignedReplay(records,()=>({recordSession:session,context,assertCurrent:session.assertCurrent,
    observe:expected=>observeEvmTransaction(expected,read,session.assertCurrent),
    async dispatch(bytes){dispatched.push(bytes);if(lost)throw Error('lost');return Transaction.from(bytes).hash!;}}),()=>clock,n=>new Uint8Array(n).fill(9));
  async function append(n:number,type=2,to:string|null=recipient,data='0x'){
    const bytes=await wallet.signTransaction({type,chainId:7654321,nonce:n,to,value:1,gasLimit:100000,
      ...(type===2?{maxFeePerGas:3,maxPriorityFeePerGas:1}:{gasPrice:3}),data,
      ...(type===1?{accessList:[{address:recipient,storageKeys:['0x'+'00'.repeat(32)]}]}:{})});
    const tx=Transaction.from(bytes);await records.append(session,{rawTransaction:bytes,hash:tx.hash!,from:wallet.address,chainId:'7654321',nonce:n,type,context:{...context,operation:'send'}});return tx;
  }
  return {records,session,create,append,dispatched,calls,receipts,read,context,bytes:()=>raw,nonce(n:number){nonce=n;},expire(){clock+=90001;},revoke(){revoked=true;},lost(){lost=true;}};
}

test('reorg and cold reopen select predecessor by hash and replay exact bytes without signing',async()=>{
 const f=await fixture(), first=await f.append(0), second=await f.append(1);
 await f.records.updatePhase(f.session,'7654321',wallet.address,first.hash!,'confirmed');
 await f.records.updatePhase(f.session,'7654321',wallet.address,second.hash!,'submitted');
 const reopened=f.create(), later=await reopened.prepare(second.hash!);assert.equal(later.status,'review');if(later.status!=='review')return;
 assert.equal(later.review.missingNonce,'0');assert.deepEqual(later.review.predecessors.map(v=>v.hash),[first.hash]);
 const before=f.bytes(), previous=await reopened.prepare(first.hash!);assert.equal(previous.status,'review');if(previous.status!=='review')return;
 assert.equal(previous.review.hash,first.hash);await reopened.confirm(previous.review.id);
 assert.deepEqual(f.dispatched,[first.serialized]);assert.equal((await f.records.readExact(f.session,'7654321',wallet.address,second.hash!))!.rawTransaction,second.serialized);
 f.nonce(2);for(const tx of [first,second])f.receipts.set(tx.hash!,{transactionHash:tx.hash,from:wallet.address,to:recipient,status:'0x1',blockNumber:'0xa',blockHash});
 assert.equal((await reopened.prepare(second.hash!)).status,'confirmed');assert.equal(f.dispatched.length,1);assert.notEqual(f.bytes(),before);
});
for(const type of [0,1,2])test(`type ${type} contract creation and large calldata keep exact wire bytes`,async()=>{
 const f=await fixture(), tx=await f.append(0,type,null,'0x'+'60'.repeat(10000)), replay=f.create();const result=await replay.prepare(tx.hash!);assert.equal(result.status,'review');if(result.status!=='review')return;
 assert.equal(result.review.to,null);assert.equal(result.review.dataBytes,10000);assert.equal(result.review.accessListEntries,type===1?1:0);
 await replay.confirm(result.review.id);assert.equal(f.dispatched[0],tx.serialized);
});
test('review cancellation is ID scoped, confirmation is one-use, and expiry prevents dispatch',async()=>{
 const f=await fixture(),tx=await f.append(0),replay=f.create();let result=await replay.prepare(tx.hash!);if(result.status!=='review')throw Error('review');
 replay.cancel('unrelated');await replay.confirm(result.review.id);await assert.rejects(replay.confirm(result.review.id),{code:'EXPIRED'});assert.equal(f.dispatched.length,1);
 result=await replay.prepare(tx.hash!);if(result.status!=='review')throw Error('review');f.expire();await assert.rejects(replay.confirm(result.review.id),{code:'EXPIRED'});assert.equal(f.dispatched.length,1);
});
test('lost dispatch acknowledgement is unknown and exact bytes stay retained',async()=>{
 const f=await fixture(),tx=await f.append(0),replay=f.create(),result=await replay.prepare(tx.hash!);if(result.status!=='review')throw Error('review');f.lost();
 assert.deepEqual(await replay.confirm(result.review.id),{status:'unknown',hash:tx.hash});assert.equal(f.dispatched.length,1);
 assert.equal((await f.records.readExact(f.session,'7654321',wallet.address,tx.hash!))!.rawTransaction,tx.serialized);
});
test('canonical receipt identity and current chain are mandatory',async()=>{
 const f=await fixture(),tx=await f.append(0);f.receipts.set(tx.hash!,{transactionHash:tx.hash,from:wallet.address,to:recipient,status:'0x1',blockNumber:'0xa',blockHash:'0x'+'44'.repeat(32)});
 await assert.rejects(f.create().prepare(tx.hash!));assert.equal(f.dispatched.length,0);
 await assert.rejects(observeEvmTransaction({hash:tx.hash!,from:wallet.address,to:recipient,chainId:'1',nonce:'0'},f.read,()=>undefined));
});

test('an old review cannot cancel a newer review, while matching cancellation revokes in-flight confirmation', async()=>{
 const f=await fixture(),tx=await f.append(0),replay=f.create();
 const a=await replay.prepare(tx.hash!),b=await replay.prepare(tx.hash!);if(a.status!=='review'||b.status!=='review')throw Error('review');
 assert.notEqual(a.review.id,b.review.id);replay.cancel(a.review.id);
 const original=f.session.keyring.decryptPrivateRecord.bind(f.session.keyring);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
 f.session.keyring.decryptPrivateRecord=async args=>{entered();await gate;return original(args);};
 const work=replay.confirm(b.review.id);await started;replay.cancel(b.review.id);release();
 await assert.rejects(work,{code:'CONTEXT_CHANGED'});assert.equal(f.dispatched.length,0);
});
test('sender pages authenticate once and keep exact values without raw bytes in public projections',async()=>{
 const f=await fixture();for(let n=0;n<4;n++)await f.append(n);
 const replay=f.create(),first=await replay.list({maximum:2});
 assert.deepEqual(first.transactions.map(row=>row.nonce),[3,2]);assert(first.nextCursor);
 const next=await replay.list({maximum:2,beforeHash:first.nextCursor});assert.deepEqual(next.transactions.map(row=>row.nonce),[1,0]);assert.equal(next.nextCursor,null);
 assert(!JSON.stringify(first).includes('rawTransaction'));assert.equal(first.transactions[0]!.value,'1');
});

test('shared observation rejects accessors before any read',async()=>{
 const f=await fixture(),tx=await f.append(0);let getters=0;
 const input={chainId:'7654321',hash:tx.hash!,from:wallet.address,to:recipient,nonce:'0'};
 Object.defineProperty(input,'hash',{enumerable:true,get(){getters++;return tx.hash;}});
 await assert.rejects(observeEvmTransaction(input,f.read,()=>undefined),{code:'INVALID_INPUT'});
 assert.equal(getters,0);assert.equal(f.calls.length,0);
});

for(const phase of ['confirmed','reverted','nonce-consumed'] as const)test(`a missing ${phase} outcome is revised before canceled or lost-ack review`,async()=>{
 const f=await fixture(),tx=await f.append(0);await f.records.updatePhase(f.session,'7654321',wallet.address,tx.hash!,phase);
 const replay=f.create(),review=await replay.prepare(tx.hash!);if(review.status!=='review')throw Error('review');
 replay.cancel(review.review.id);
 const reopened=f.create();assert.equal((await reopened.get(tx.hash!))!.phase,'submitted');assert.equal(f.dispatched.length,0);
 const retry=await reopened.prepare(tx.hash!);if(retry.status!=='review')throw Error('review');f.lost();
 assert.equal((await reopened.confirm(retry.review.id)).status,'unknown');
 assert.equal((await f.create().get(tx.hash!))!.phase,'submitted');
 assert.equal((await f.records.readExact(f.session,'7654321',wallet.address,tx.hash!))!.rawTransaction,tx.serialized);
});

for(const outcome of ['confirmed','reverted','nonce-consumed'] as const)test(`public ${outcome} observation matches its persisted transaction phase`,async()=>{
 const f=await fixture(),tx=await f.append(0);
 if(outcome==='nonce-consumed')f.nonce(1);
 else f.receipts.set(tx.hash!,{transactionHash:tx.hash,from:wallet.address,to:recipient,status:outcome==='confirmed'?'0x1':'0x0',blockNumber:'0xa',blockHash});
 const result=await f.create().prepare(tx.hash!);assert.equal(result.status,outcome);
 assert.equal(result.transaction.phase,outcome);
 assert.equal((await f.records.readExact(f.session,'7654321',wallet.address,tx.hash!))!.phase,outcome);
});
