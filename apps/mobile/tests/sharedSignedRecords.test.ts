import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { Wallet, Transaction } from 'ethers';
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { EvmSignedRecords, inspectEvmSignedBundle, type EvmSignedRecordSession, type EvmSignedRecordStorage, type EvmSignedPhase } from '../../../source/wallet/evmSignedRecords.ts';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const signer = new Wallet(`0x${'11'.repeat(32)}`);
function fixture(now: () => number = () => 1000) {
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false }; keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0; keyring.getDecryptedMnemonic = () => 'synthetic shared signed-record root';
  let stored: string | undefined, revision = 0, writes = 0;
  const port: EvmSignedRecordStorage = { async read() { return stored; }, async compareAndSet(_id, expected, next, check) { check(); if (stored !== expected) return false; stored=next; writes++; return true; } };
  const session = (): EvmSignedRecordSession => { const captured=revision; return { keyring, assertCurrent() { if (revision!==captured) throw Error('revoked'); } }; };
  return { store:new EvmSignedRecords(port,now),session,value:()=>stored,replace(value:string|undefined){stored=value;},writes:()=>writes,revoke(){revision++;},port };
}
async function signed(nonce=0,type=2,data='0x',alias='HDAccount') {
  const rawTransaction=await signer.signTransaction({ type,chainId:7654321,nonce,to:signer.address,value:123,gasLimit:42000,
    ...(type===2?{maxFeePerGas:3,maxPriorityFeePerGas:1}:{gasPrice:2}),data,
    ...(type===1?{accessList:[{address:signer.address,storageKeys:[`0x${'22'.repeat(32)}`]}]}:{}) });
  return { rawTransaction,hash:Transaction.from(rawTransaction).hash!,from:signer.address,chainId:'7654321',nonce,type,
    context:{account:{type:alias,id:alias==='Imported'?9:0,address:signer.address},network:{kind:'ethereum',chainId:7654321,slip44:60,url:'https://offline.invalid'},operation:'send' as const} };
}
test('actual SDK encryption retains aliases and type0/1/2 predecessor bytes after restart',async()=>{
 const f=fixture(),inputs=[]; for(const type of [0,1,2]){const input=await signed(type,type,'0x',type===1?'Imported':'HDAccount');inputs.push(input);await f.store.append(f.session(),input);}
 const profile=await f.session().keyring.getPrivateRecordProfileId();assert.equal(inspectEvmSignedBundle(f.value()!,profile).transactions,3);assert.equal((await f.store.listSender(f.session(),'7654321',signer.address)).length,3);
 await f.store.updatePhase(f.session(),'7654321',signer.address,inputs[0]!.hash,'confirmed');const reopened=new EvmSignedRecords(f.port);
 for(const input of inputs)assert.equal((await reopened.readExact(f.session(),'7654321',signer.address,input.hash))!.rawTransaction,input.rawTransaction);
 assert.equal(await reopened.validate(f.session()),3);
});
test('duplicate append retains original attribution and exact ciphertext',async()=>{const f=fixture(),input=await signed();await f.store.append(f.session(),input);const before=f.value(),writes=f.writes();
 const result=await f.store.append(f.session(),{...input,context:{...input.context,account:{...input.context.account,type:'Imported',id:1}}});assert.equal(result.signer.type,'HDAccount');assert.equal(f.value(),before);assert.equal(f.writes(),writes);
});
test('chunking retains large calldata beyond one private-record bound',async()=>{const f=fixture(),input=await signed(0,2,'0x'+'ab'.repeat(100000));await f.store.append(f.session(),input);assert.equal((await f.store.readExact(f.session(),'7654321',signer.address,input.hash))!.rawTransaction,input.rawTransaction);assert(JSON.parse(f.value()!).entries[0].chunks.length>1);});
test('tampering or a different profile refuses without a write',async()=>{const f=fixture(),input=await signed();await f.store.append(f.session(),input);const saved=f.value()!,corrupt=JSON.parse(saved);corrupt.entries[0].nonce++;f.replace(JSON.stringify(corrupt));await assert.rejects(f.store.validate(f.session()));assert.equal(f.writes(),1);const other=fixture();other.replace(saved);(other.session().keyring as any).getDecryptedMnemonic=()=> 'different root';await assert.rejects(other.store.validate(other.session()));});
test('caller identity is captured before the first encryption await',async()=>{const f=fixture(),input=await signed();const promise=f.store.append(f.session(),input);input.context.account.id=300;input.context.network.chainId=1;assert.equal((await promise).signer.id,0);assert.equal((await f.store.listSender(f.session(),'7654321',signer.address))[0]!.chainId,'7654321');});

test('same-nonce alternatives and nonce-used observations never replace predecessor bytes',async()=>{
 const f=fixture(),first=await signed(0,2,'0x01'),alternative=await signed(0,2,'0x02'),next=await signed(1);
 for(const input of [first,alternative,next])await f.store.append(f.session(),input);
 await f.store.updatePhase(f.session(),'7654321',signer.address,first.hash,'nonce-consumed');
 const all=await f.store.listSender(f.session(),'7654321',signer.address);assert.equal(all.length,3);
 for(const input of [first,alternative,next])assert.equal((await f.store.readExact(f.session(),'7654321',signer.address,input.hash))!.rawTransaction,input.rawTransaction);
});
test('retries an exact CAS miss, while exhausting conflicts never acknowledges append',async()=>{
 const f=fixture(),input=await signed();const original=f.port.compareAndSet;let misses=1;
 f.port.compareAndSet=async(...args)=>misses-->0?false:original(...args);
 await f.store.append(f.session(),input);assert.equal(f.writes(),1);
 f.port.compareAndSet=async()=>false;await assert.rejects(f.store.append(f.session(),await signed(1)),/CONFLICT/);assert.equal(f.writes(),1);
});
test('revocation after encryption prevents persistence and metadata accessors never execute',async()=>{
 const f=fixture(),session=f.session(),input=await signed();let getterCalls=0;
 const metadata=Object.defineProperty({},'secret',{enumerable:true,get(){getterCalls++;return 'no';}});
 assert.throws(()=>f.store.append(session,input,metadata));assert.equal(getterCalls,0);assert.equal(f.writes(),0);
 const original=session.keyring.encryptPrivateRecord.bind(session.keyring);
 session.keyring.encryptPrivateRecord=async(args)=>{const value=await original(args);f.revoke();return value;};
 await assert.rejects(f.store.append(session,input),/revoked/);assert.equal(f.writes(),0);
});
test('oversized canonical input refuses before JSON parsing',()=>{
 assert.throws(()=>inspectEvmSignedBundle('x'.repeat(16*1024*1024+1)),/CAPACITY/);
});

test('generic contract creation, access lists and replacement records keep every immutable byte', async () => {
  const f = fixture();
  const initial = await signed(4, 1, '0x123456');
  await f.store.append(f.session(), initial);
  const rawTransaction = await signer.signTransaction({type:2,chainId:7654321,nonce:4,value:0,data:'0x60006000',gasLimit:100000,maxFeePerGas:5,maxPriorityFeePerGas:2});
  const replacement = {...initial,rawTransaction,hash:Transaction.from(rawTransaction).hash!,type:2,
    context:{...initial.context,operation:'speed-up' as const,originalHash:initial.hash}};
  await f.store.append(f.session(),replacement);
  const all=await f.store.listSender(f.session(),'7654321',signer.address);
  assert.equal(all.length,2);assert.equal(all[1]!.originalHash,initial.hash);
  assert.equal((await f.store.readExact(f.session(),'7654321',signer.address,replacement.hash))!.rawTransaction,rawTransaction);
  assert.equal(Transaction.from(rawTransaction).to,null);
  assert.equal((await f.store.readExact(f.session(),'7654321',signer.address,initial.hash))!.rawTransaction,initial.rawTransaction);
});
test('wrong signed hash, sender or chain refuses without creating a bundle', async () => {
  for(const change of ['hash','sender','chain'] as const){
    const f=fixture(), input=await signed();
    if(change==='hash')input.hash='0x'+'99'.repeat(32);
    if(change==='sender')input.context.account.address='0x'+'11'.repeat(20);
    if(change==='chain')input.context.network.chainId=1;
    await assert.rejects(async()=>f.store.append(f.session(),input));
    assert.equal(f.value(),undefined);assert.equal(f.writes(),0);
  }
});
test('late acknowledged cancellation preserves bytes without quarantining a healthy store',async()=>{
  const f=fixture(),input=await signed(),original=f.port.compareAndSet;
  f.port.compareAndSet=async(...args)=>{const result=await original(...args);f.revoke();return result;};
  await assert.rejects(f.store.append(f.session(),input),/revoked/);
  assert.equal(f.store.requiresReopen,false);assert.equal(f.writes(),1);
  const reopened=new EvmSignedRecords(f.port);
  assert.equal((await reopened.readExact(f.session(),'7654321',signer.address,input.hash))!.rawTransaction,input.rawTransaction);
});
test('ambiguous storage acknowledgement quarantines every operation until a fresh adapter opens',async()=>{
  const f=fixture(),input=await signed(),original=f.port.compareAndSet;
  f.port.compareAndSet=async(...args)=>{await original(...args);throw Object.assign(Error('commit acknowledgement lost'),{code:'STORAGE_REOPEN_REQUIRED'});};
  await assert.rejects(f.store.append(f.session(),input),/acknowledgement lost/);
  assert.equal(f.store.requiresReopen,true);
  await assert.rejects(f.store.listSender(f.session(),'7654321',signer.address),/REOPEN_REQUIRED/);
  const reopened=new EvmSignedRecords(f.port);
  assert.equal((await reopened.readExact(f.session(),'7654321',signer.address,input.hash))!.rawTransaction,input.rawTransaction);
});

test('new admission enforces shared protocol gas limits without erasing readable historical bytes',async()=>{
 const {historicalSignedBundle}=await import('./signedRecordTestSession.ts');
 for(const type of [0,1,2]){
   const f=fixture(), raw=await signer.signTransaction({type,chainId:1,nonce:0,to:signer.address,value:1,gasLimit:16777217,
     ...(type===2?{maxFeePerGas:3,maxPriorityFeePerGas:1}:{gasPrice:2})});
   const tx=Transaction.from(raw),input={...(await signed()),rawTransaction:raw,hash:tx.hash!,type,context:{...(await signed()).context,network:{kind:'ethereum',chainId:1,slip44:60,url:'https://offline.invalid'}}};
   const session=f.session();f.replace(await historicalSignedBundle(session,raw));const before=f.value();
   assert.equal((await f.store.readExact(session,'1',signer.address,tx.hash!))!.rawTransaction,raw);
   assert.throws(()=>f.store.append(session,input));assert.equal(f.value(),before);assert.equal(f.writes(),0);
 }
});

test('bounded batch reads and native alias Activity include contract creation and access-list calls',async()=>{
 const {createNativeSignedRecordView}=await import('../src/custody/sharedSignedRecords.ts');
 const {createNativeNetwork}=await import('../src/custody/networkContext.ts');
 const f=fixture(), first=await signed(0,1,'0x1234');await f.store.append(f.session(),first);
 const raw=await signer.signTransaction({type:2,chainId:7654321,nonce:1,data:'0x6000',value:0,gasLimit:80000,maxFeePerGas:3,maxPriorityFeePerGas:1});
 const second={...first,rawTransaction:raw,hash:Transaction.from(raw).hash!,type:2,nonce:1};await f.store.append(f.session(),second);
 const latest=await f.store.readRecent(f.session(),'7654321',signer.address,1);
 assert.equal(latest.total,2);assert.deepEqual(latest.entries.map(entry=>entry.hash),[second.hash]);
 const network=createNativeNetwork({id:'custom:7654321',name:'Custom',kind:'evm',chainId:'7654321',slip44:60,rpcUrl:'https://offline.invalid',symbol:'ANY',decimals:18,testnet:true});
 const hd=createNativeSignedRecordView(f.store,f.session(),'1'.repeat(64),{type:'HDAccount',index:0,address:signer.address},network);
 const imported=createNativeSignedRecordView(f.store,f.session(),'1'.repeat(64),{type:'Imported',index:9,address:signer.address},network);
 const a=await hd.activities(),b=await imported.activities();
 assert.deepEqual(a.records.map(row=>row.hash),[first.hash,second.hash]);
 assert.deepEqual(b.records.map(row=>row.hash),a.records.map(row=>row.hash));
 assert.equal(a.records[1]!.recipient,null);assert.equal(a.records[0]!.amountUnits,'123');
 assert.equal(a.truncated,false);assert.equal(b.records[0]!.accountId,'imported:60:9');
});

for (const phase of ['signed', 'attempted', 'submitted'] as const) {
  test(`shared current query keeps ${phase} visible after clock rollback, later terminal writes and alias reopen`, async () => {
    const { createNativeSignedRecordView } = await import('../src/custody/sharedSignedRecords.ts');
    const { createNativeNetwork } = await import('../src/custody/networkContext.ts');
    let clock = 1000;
    const f = fixture(() => clock);
    const older = await signed(7), pending = await signed(1, 2, '0x', 'Imported'), later = await signed(2);
    await f.store.append(f.session(), older);
    await f.store.updatePhase(f.session(), '7654321', signer.address, older.hash, 'confirmed');
    clock = 100;
    await f.store.append(f.session(), pending);
    if (phase !== 'signed') await f.store.updatePhase(f.session(), '7654321', signer.address, pending.hash, phase);
    // A later completed alternative cannot conceal unresolved work either.
    clock = 50;
    await f.store.append(f.session(), later);
    await f.store.updatePhase(f.session(), '7654321', signer.address, later.hash, 'reverted');
    const reopened = new EvmSignedRecords(f.port);
    assert.equal((await reopened.readCurrent(f.session(), '7654321', signer.address))?.hash, pending.hash);
    const network = createNativeNetwork({ id:'custom:7654321', name:'Custom', kind:'evm', chainId:'7654321', slip44:60, rpcUrl:'https://offline.invalid', symbol:'ANY', decimals:18, testnet:true });
    for (const account of [{type:'HDAccount' as const,index:0}, {type:'Imported' as const,index:9}]) {
      const view = createNativeSignedRecordView(reopened, f.session(), '1'.repeat(64), {...account,address:signer.address}, network);
      const current = await view.load();
      assert.equal(current?.hash, pending.hash);
      assert.equal(current?.rawTransaction, pending.rawTransaction);
      assert.equal(current?.createdAt, 100);
    }
    await reopened.updatePhase(f.session(), '7654321', signer.address, pending.hash, 'confirmed');
    assert.equal((await reopened.readCurrent(f.session(), '7654321', signer.address))?.hash, later.hash, 'all-terminal fallback follows append order, not timestamp or nonce');
    assert.equal(await reopened.readCurrent(f.session(), '1', signer.address), null);
  });
}

test('current selection follows committed append order across unresolved alternatives and later phase updates', async () => {
  let clock = 2000;
  const f = fixture(() => clock), first = await signed(3, 2, '0x01'), second = await signed(3, 2, '0x02');
  assert.equal(await f.store.readCurrent(f.session(), '7654321', signer.address), null);
  await f.store.append(f.session(), first);
  clock = 1000;
  await f.store.append(f.session(), second);
  await f.store.updatePhase(f.session(), '7654321', signer.address, first.hash, 'attempted');
  assert.equal((await f.store.readCurrent(f.session(), '7654321', signer.address))?.hash, second.hash);
  await f.store.updatePhase(f.session(), '7654321', signer.address, second.hash, 'confirmed');
  assert.equal((await f.store.readCurrent(f.session(), '7654321', signer.address))?.hash, first.hash);
  await f.store.updatePhase(f.session(), '7654321', signer.address, first.hash, 'nonce-consumed');
  assert.equal((await f.store.readCurrent(f.session(), '7654321', signer.address))?.hash, second.hash);
});

test('near-limit append reserves space for every phase and the largest supported revision', async () => {
  const f=fixture(), first=await signed(0), second=await signed(1);
  const limit=16*1024*1024;
  const maximum=Object.fromEntries(Array.from({length:1023},(_,i)=>[`k${String(i).padStart(4,'0')}`,'x'.repeat(8192)]));
  const metadataBytes=(target:number) => {
    const metadata=Object.fromEntries(Object.keys(maximum).map(key=>[key,'']));
    let remaining=target-Buffer.byteLength(JSON.stringify(metadata));
    assert(remaining>=0 && remaining<=1023*8192);
    for(const key of Object.keys(metadata)){const count=Math.min(remaining,8192);metadata[key]='x'.repeat(count);remaining-=count;}
    assert.equal(remaining,0);assert.equal(Buffer.byteLength(JSON.stringify(metadata)),target);
    return metadata;
  };
  await f.store.append(f.session(),first,maximum);
  const before=f.value()!;
  const probe=fixture();probe.replace(before);await probe.store.append(probe.session(),second,{});
  const metadataAtHardLimit=2+limit-Buffer.byteLength(probe.value()!);
  await assert.rejects(f.store.append(f.session(),second,metadataBytes(metadataAtHardLimit)),/CAPACITY/);
  assert.equal(f.value(),before,'refused append preserves the acknowledged bundle');
  await f.store.append(f.session(),second,metadataBytes(metadataAtHardLimit-64));
  assert.equal(Buffer.byteLength(f.value()!),limit-64);
  const stored=JSON.parse(f.value()!),chunks=stored.entries.map((entry:any)=>JSON.stringify(entry.chunks));
  const phaseCases: Record<EvmSignedPhase, true> = { attempted:true, submitted:true, confirmed:true, reverted:true, 'nonce-consumed':true, signed:true };
  const phases=Object.keys(phaseCases) as EvmSignedPhase[];
  // This is the state reached after repeated legitimate status revisions. Only
  // the root revision changes; all original ciphertext and signed bytes remain.
  const revision=Number.MAX_SAFE_INTEGER-phases.length*2;
  const plain=await f.session().keyring.decryptPrivateRecord({domain:stored.root.domain,recordId:'manifest',envelope:stored.root});
  const root=JSON.parse(new TextDecoder().decode(plain));plain.fill(0);root.revision=revision;
  stored.revision=revision;
  stored.root=await f.session().keyring.encryptPrivateRecord({domain:stored.root.domain,recordId:'manifest',plaintext:new TextEncoder().encode(JSON.stringify(root))});
  f.replace(JSON.stringify(stored));assert.equal(await f.store.validate(f.session()),2);
  for(const phase of phases)for(const input of [first,second]){
    await f.store.updatePhase(f.session(),'7654321',signer.address,input.hash,phase);
    assert(Buffer.byteLength(f.value()!)<=limit);
  }
  const last=JSON.parse(f.value()!);
  assert.equal(last.revision,Number.MAX_SAFE_INTEGER);
  assert.deepEqual(last.entries.map((entry:any)=>JSON.stringify(entry.chunks)),chunks);
  const full=f.value();await assert.rejects(f.store.updatePhase(f.session(),'7654321',signer.address,first.hash,'submitted'),/CAPACITY/);
  assert.equal(f.value(),full);
});
