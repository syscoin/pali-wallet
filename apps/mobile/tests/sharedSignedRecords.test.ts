import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { Wallet, Transaction } from 'ethers';
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { captureEvmSubmission, evmSubmissionFailure, submitSignedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { EvmSignedRecords, createEvmSignedRecordLifecycle, inspectEvmSignedBundle, consumeSignedEvmCapacityRefusal, type EvmSignedRecordSession, type EvmSignedRecordStorage, type EvmSignedPhase } from '../../../source/wallet/evmSignedRecords.ts';
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
test('a new ordinary attempt cannot redispatch identical saved bytes under an account alias', async () => {
  const f = fixture(), input = await signed();
  await f.store.append(f.session(), input);
  const before = f.value(), writes = f.writes();
  await assert.rejects(f.store.append(f.session(), {
    ...input, context: { ...input.context, account: { ...input.context.account, type: 'Imported', id: 1 } },
  }), { code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT', recoveryHash: input.hash, transactionNotBroadcast: true });
  const saved = await f.store.readExact(f.session(), input.chainId, signer.address, input.hash);
  assert.equal(saved?.signer.type, 'HDAccount');
  assert.equal(f.value(), before);
  assert.equal(f.writes(), writes);
});
test('chunking retains large calldata beyond one private-record bound',async()=>{const f=fixture(),input=await signed(0,2,'0x'+'ab'.repeat(100000));await f.store.append(f.session(),input);assert.equal((await f.store.readExact(f.session(),'7654321',signer.address,input.hash))!.rawTransaction,input.rawTransaction);assert(JSON.parse(f.value()!).entries[0].chunks.length>1);});
test('tampering or a different profile refuses without a write',async()=>{const f=fixture(),input=await signed();await f.store.append(f.session(),input);const saved=f.value()!,corrupt=JSON.parse(saved);corrupt.entries[0].nonce++;f.replace(JSON.stringify(corrupt));await assert.rejects(f.store.validate(f.session()));assert.equal(f.writes(),1);const other=fixture();other.replace(saved);(other.session().keyring as any).getDecryptedMnemonic=()=> 'different root';await assert.rejects(other.store.validate(other.session()));});
test('caller identity is captured before the first encryption await',async()=>{const f=fixture(),input=await signed();const promise=f.store.append(f.session(),input);input.context.account.id=300;input.context.network.chainId=1;assert.equal((await promise).signer.id,0);assert.equal((await f.store.listSender(f.session(),'7654321',signer.address))[0]!.chainId,'7654321');});

test('ordinary nonce ownership survives terminal observations and keeps different nonces independent', async () => {
  const f = fixture(), first = await signed(0, 2, '0x01'), alternative = await signed(0, 2, '0x02'), next = await signed(1);
  const session = f.session();
  await f.store.append(session, first);
  await f.store.append(session, next);
  for (const phase of ['signed', 'confirmed', 'reverted', 'nonce-consumed'] as const) {
    if (phase !== 'signed') await f.store.updatePhase(session, first.chainId, signer.address, first.hash, phase);
    const conflict = { code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT', recoveryHash: first.hash, transactionNotBroadcast: true };
    await assert.rejects(f.store.assertSpendingNonce(session, first.chainId, signer.address, 0), conflict);
    await assert.rejects(f.store.append(session, alternative), conflict);
  }
  assert.equal((await f.store.listSender(session, first.chainId, signer.address)).length, 2);
  for (const input of [first, next])
    assert.equal((await f.store.readExact(session, input.chainId, signer.address, input.hash))?.rawTransaction, input.rawTransaction);
});
test('an ordinary append rechecks ownership after a different journal instance wins the CAS', async () => {
  const f = fixture(), winner = await signed(0, 2, '0x01'), loser = await signed(0, 2, '0x02');
  const other = new EvmSignedRecords({ ...f.port });
  const commit = f.port.compareAndSet;
  f.port.compareAndSet = async (...args) => {
    f.port.compareAndSet = commit;
    await other.append(f.session(), winner);
    return commit(...args);
  };
  await assert.rejects(f.store.append(f.session(), loser), {
    code: 'EVM_SIGNED_RECORD_NONCE_CONFLICT', recoveryHash: winner.hash, transactionNotBroadcast: true,
  });
  assert.equal(f.writes(), 1);
  assert.equal(await f.store.readExact(f.session(), loser.chainId, signer.address, loser.hash), null);
});
test('pending pages use an append-order cursor even after the cursor becomes terminal', async () => {
  const f = fixture(), session = f.session();
  const [first, confirmed, cursor, latest, reverted, later] = await Promise.all([
    signed(0), signed(1), signed(2), signed(3), signed(4), signed(5),
  ] as const);
  const write = (entry: typeof first, phase: EvmSignedPhase) =>
    f.store.updatePhase(session, entry.chainId, signer.address, entry.hash, phase);
  for (const input of [first, confirmed, cursor, latest, reverted]) await f.store.append(session, input);
  await write(confirmed, 'confirmed');
  await write(cursor, 'attempted');
  await write(latest, 'submitted');
  await write(reverted, 'reverted');
  const options = { maximum: 2, pendingOnly: true } as const;
  const read = (beforeHash?: string) => f.store.readPage(session, first.chainId, signer.address, { ...options, beforeHash });
  const page = await read();
  assert.deepEqual(page.entries.map(({ hash, phase }) => [hash, phase]), [[latest.hash, 'submitted'], [cursor.hash, 'attempted']]);
  assert.equal(page.nextCursor, cursor.hash);
  assert.equal(page.total, 3);
  await write(cursor, 'confirmed');
  await f.store.append(session, later);
  const previous = await read(page.nextCursor!);
  assert.deepEqual(previous.entries.map(({ hash, phase }) => [hash, phase]), [[first.hash, 'signed']]);
  assert.equal(previous.nextCursor, null);
  assert.deepEqual((await read()).entries.map(({ hash }) => hash), [later.hash, latest.hash]);
});
test('retries an exact CAS miss, while exhausting conflicts never acknowledges append',async()=>{
 const f=fixture(),input=await signed();const original=f.port.compareAndSet;let misses=1;
 f.port.compareAndSet=async(...args)=>misses-->0?false:original(...args);
 await f.store.append(f.session(),input);assert.equal(f.writes(),1);
 f.port.compareAndSet=async()=>false;await assert.rejects(f.store.append(f.session(),await signed(1)),/CONFLICT/);assert.equal(f.writes(),1);
});
test('a replacement rechecks its pending predecessor after a concurrent journal change', async () => {
  const f = fixture();
  const original = await signed(0, 2, '0x01');
  const candidate = await signed(0, 2, '0x02');
  await f.store.append(f.session(), original);
  const binding = (await f.store.readReplacement(f.session(), original.chainId, signer.address, original.hash, 'speed-up'))!.binding!;
  const concurrent = fixture();
  concurrent.replace(f.value());
  await concurrent.store.updatePhase(concurrent.session(), '7654321', signer.address, original.hash, 'confirmed');
  f.port.compareAndSet = async () => {
    f.replace(concurrent.value());
    return false;
  };
  await assert.rejects(f.store.append(f.session(), {
    ...candidate,
    context: { ...candidate.context, operation: 'speed-up', originalHash: original.hash },
  }, undefined, binding), /EVM_SIGNED_RECORD_ORIGINAL_CHANGED/);
  assert.equal(await f.store.readExact(f.session(), '7654321', signer.address, candidate.hash), null);
  assert.equal((await f.store.readExact(f.session(), '7654321', signer.address, original.hash))?.phase, 'confirmed');
});
test('a copied binding, changed tip or intervening cancellation blocks a retained replacement', async () => {
  const f = fixture(), original = await signed();
  const session = f.session();
  const read = (operation: 'speed-up' | 'cancel' = 'speed-up') =>
    f.store.readReplacement(session, original.chainId, signer.address, original.hash, operation);
  const attempt = async (fee: number, data = '0x') => {
    const rawTransaction = await signer.signTransaction({
      type: 2, chainId: 7654321, nonce: 0, to: signer.address, value: 123,
      gasLimit: 50_400, maxFeePerGas: fee, maxPriorityFeePerGas: 2, data,
    });
    return { ...original, rawTransaction, hash: Transaction.from(rawTransaction).hash!,
      context: { ...original.context, operation: 'speed-up' as const, originalHash: original.hash } };
  };
  await f.store.append(session, original);
  const initial = (await read())!.binding!;
  const first = await attempt(5);
  await assert.rejects(f.store.append(session, first, undefined, { ...initial }), /ORIGINAL_CHANGED/);
  await f.store.append(session, first, undefined, initial);
  await assert.rejects(f.store.append(session, await attempt(6), undefined, initial), /ORIGINAL_CHANGED/);
  assert.equal((await read())!.binding!.expectedTipHash, first.hash);
  assert.deepEqual((await read())!.rates, { type: 2, maxFeePerGas: 5n, maxPriorityFeePerGas: 2n });
  await assert.rejects(f.store.append(session, await attempt(7, '0x01')), /ORIGINAL_CHANGED/);
  assert.equal((await read())!.binding!.expectedTipHash, first.hash);
  const rawTransaction = await signer.signTransaction({
    type: 2, chainId: 7654321, nonce: 0, to: signer.address, value: 0,
    gasLimit: 21_000, maxFeePerGas: 7, maxPriorityFeePerGas: 3,
  });
  const cancelHash = Transaction.from(rawTransaction).hash!;
  const cancel = { ...original, rawTransaction, hash: cancelHash,
    context: { ...original.context, operation: 'cancel' as const, originalHash: original.hash } };
  await assert.rejects(f.store.append(session, cancel, undefined, (await read())!.binding!), /ORIGINAL_CHANGED/);
  await f.store.append(session, cancel, undefined, (await read('cancel'))!.binding!);
  assert.equal(await read(), null);
  assert.equal((await f.store.readExact(session, original.chainId, signer.address, original.hash))!.rawTransaction, original.rawTransaction);
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
  const session = f.session();
  await assert.rejects(f.store.append(session, replacement), /ORIGINAL_CHANGED/);
  const binding = await f.store.captureVerifiedReplacement(session, {
    chainId: initial.chainId, from: initial.from, nonce: initial.nonce,
    operation: 'speed-up', originalHash: initial.hash,
  });
  await f.store.append(session, replacement, undefined, binding);
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

test('current selection follows committed append order across unresolved nonces and later phase updates', async () => {
  let clock = 2000;
  const f = fixture(() => clock), first = await signed(3, 2, '0x01'), second = await signed(4, 2, '0x02');
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

  // Submit through the installed SDK and production signed-record lifecycle,
  // with a real authenticated full bundle and no network transport.
  const third=await signed(2);
  const digest=(value:string) => createHash('sha256').update(value).digest('hex');
  const beforeCapacity=f.value()!, beforeCapacityDigest=digest(beforeCapacity);
  const beforeCapacityWrites=f.writes();
  let blockedBroadcasts=0;
  const session=f.session();
  const fullBoundary=captureEvmSubmission(third.context,session.assertCurrent,
    () => createEvmSignedRecordLifecycle(f.store, session, { retirementRead: null }));
  const unsigned=Transaction.from(third.rawTransaction).unsignedSerialized;
  let capacityError:unknown;
  try {
    await submitSignedEvmTransaction(third.rawTransaction,({admit}) => {
      blockedBroadcasts++;
      return admit(async () => third.hash);
    },fullBoundary,undefined,unsigned);
  } catch (error) { capacityError=error; }
  assert(capacityError instanceof Error);
  assert.equal(capacityError.message,'EVM_SIGNED_RECORD_CAPACITY');
  assert.equal(consumeSignedEvmCapacityRefusal(capacityError,evmSubmissionFailure),true);
  assert.equal(consumeSignedEvmCapacityRefusal(capacityError,evmSubmissionFailure),false);
  assert.equal(consumeSignedEvmCapacityRefusal(Object.assign(new Error('EVM_SIGNED_RECORD_CAPACITY'),{transactionNotBroadcast:true}),evmSubmissionFailure),false);
  assert.deepEqual(evmSubmissionFailure(capacityError),{
    transactionNotBroadcast:true,signedTransactionHash:third.hash,
  });
  assert.equal(blockedBroadcasts,0,'capacity refusal must precede broadcast');
  assert.equal(f.writes(),beforeCapacityWrites);
  assert.equal(digest(f.value()!),beforeCapacityDigest,'bundle must be unchanged');
  assert.equal(await f.store.readExact(session,third.chainId,third.from,third.hash),null);
  for(const entry of [first,second]) {
    const retained=await f.store.readExact(session,entry.chainId,entry.from,entry.hash);
    assert(retained?.rawTransaction===entry.rawTransaction,'existing signed bytes must remain recoverable');
  }

  // Healthy control uses the same signed envelope and SDK/lifecycle on a fresh
  // isolated store, with a matching in-memory acknowledgement.
  const healthy=fixture(), healthySession=healthy.session();
  const healthyBoundary=captureEvmSubmission(third.context,healthySession.assertCurrent,
    () => createEvmSignedRecordLifecycle(healthy.store, healthySession, { retirementRead: null }));
  let healthyBroadcasts=0, healthyAdmissions=0;
  const result=await submitSignedEvmTransaction(third.rawTransaction,({admit}) => {
    healthyBroadcasts++;
    return admit(async () => {
      assert(healthy.writes()>0,'persistence must precede wire initiation');
      healthyAdmissions++;return third.hash;
    });
  },healthyBoundary,undefined,unsigned);
  assert.equal(result,third.hash);assert.equal(healthyBroadcasts,1);assert.equal(healthyAdmissions,1);
  const healthyRecord=await healthy.store.readExact(healthySession,third.chainId,third.from,third.hash);
  assert(healthyRecord?.rawTransaction===third.rawTransaction,'healthy submission must persist before dispatch');

  // The same genuine object reused as a later SDK broadcast failure receives
  // fresh local dispatched-stage evidence and must not retain the refusal.
  const reuse=fixture(), reuseSession=reuse.session();
  const reuseBoundary=captureEvmSubmission(third.context,reuseSession.assertCurrent,
    () => createEvmSignedRecordLifecycle(reuse.store, reuseSession, { retirementRead: null }));
  let reusedError:unknown, dispatched=0;
  try {
    await submitSignedEvmTransaction(third.rawTransaction,({admit})=>admit(async()=>{dispatched++;throw capacityError;}),reuseBoundary,undefined,unsigned);
  } catch(error) { reusedError=error; }
  assert.equal(reusedError,capacityError);assert.equal(dispatched,1);
  assert.equal(evmSubmissionFailure(reusedError).transactionNotBroadcast,false);
  assert.equal(consumeSignedEvmCapacityRefusal(reusedError,evmSubmissionFailure),false);

  // Even before its first classification, a real old capacity error cannot
  // label a second same-envelope invocation whose persistence succeeded.
  let stale:unknown;
  const oldSession=f.session(), oldBoundary=captureEvmSubmission(third.context,oldSession.assertCurrent,
    () => createEvmSignedRecordLifecycle(f.store, oldSession, { retirementRead: null }));
  try { await submitSignedEvmTransaction(third.rawTransaction,({admit})=>admit(async()=>third.hash),oldBoundary,undefined,unsigned); }
  catch(error) { stale=error; }
  assert(stale instanceof Error);assert.equal(evmSubmissionFailure(stale).transactionNotBroadcast,true);
  const next=fixture(), nextSession=next.session();
  const nextBoundary=captureEvmSubmission(third.context,nextSession.assertCurrent,
    () => createEvmSignedRecordLifecycle(next.store, nextSession, { retirementRead: null }));
  let nextError:unknown, nextBroadcasts=0;
  try { await submitSignedEvmTransaction(third.rawTransaction,()=>{nextBroadcasts++;throw stale;},nextBoundary,undefined,unsigned); }
  catch(error) { nextError=error; }
  assert.equal(nextError,stale);assert.equal(nextBroadcasts,1);
  assert.equal(evmSubmissionFailure(nextError).transactionNotBroadcast,true);
  assert.equal(consumeSignedEvmCapacityRefusal(nextError,evmSubmissionFailure),false);
  assert((await next.store.readExact(nextSession,third.chainId,third.from,third.hash))?.rawTransaction===third.rawTransaction);

  // Revocation wins even when the local append was capacity-refused.
  const revokedSession=f.session(), realAppend=f.store.append.bind(f.store);
  f.store.append=async (...args)=>{try{return await realAppend(...args);}catch(error){f.revoke();throw error;}};
  const revokedBoundary=captureEvmSubmission(third.context,revokedSession.assertCurrent,
    () => createEvmSignedRecordLifecycle(f.store, revokedSession, { retirementRead: null }));
  let revokedError:unknown, revokedBroadcasts=0;
  try {
    await submitSignedEvmTransaction(third.rawTransaction,({admit})=>{revokedBroadcasts++;return admit(async()=>third.hash);},revokedBoundary,undefined,unsigned);
  } catch(error) { revokedError=error; }
  f.store.append=realAppend;
  assert(revokedError instanceof Error);assert.match(revokedError.message,/revoked/);
  assert.equal(consumeSignedEvmCapacityRefusal(revokedError,evmSubmissionFailure),false);assert.equal(revokedBroadcasts,0);
  assert.equal(digest(f.value()!),beforeCapacityDigest);

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


test('automatic nonce advances only after an exact wire ACK and keeps that nonce in the held snapshot', async () => {
  const f = fixture(), session = f.session();
  const first = await signed(0), second = await signed(1);
  const endpoint = first.context.network.url;
  const scope = { chainId: first.chainId, from: first.from, endpoint, latest: 0, pending: 0 };
  const readPending = async () => null;
  const assertCurrent = session.assertCurrent;
  const plan = async () => f.store.autoNonceAcceptance.plan({
    ...scope, readPending, assertCurrent,
    snapshot: await f.store.captureAutoNonceSnapshot(session, first.chainId, first.from),
  });
  const lifecycle = createEvmSignedRecordLifecycle(f.store, session, { retirementRead: null, automaticNonceEndpoint: endpoint });
  await lifecycle.persistSigned(first);
  assert.deepEqual(await plan(), { kind: 'unresolved', nonce: 0 });
  let ack!: (hash: string) => void, dispatching!: () => void;
  const acknowledgement = new Promise<string>((resolve) => { ack = resolve; });
  const started = new Promise<void>((resolve) => { dispatching = resolve; });
  const submitted = lifecycle.dispatchSigned(first, () => {
    dispatching();
    return acknowledgement;
  }, async () => undefined);
  await started;
  assert.deepEqual(await plan(), { kind: 'unresolved', nonce: 0 });
  ack(first.hash);
  assert.equal(await submitted, first.hash);
  assert.deepEqual(await plan(), { kind: 'ready', nonce: 1, additionalNativeCost: 126123n });

  const next = createEvmSignedRecordLifecycle(f.store, session, { retirementRead: null,
    automaticNonceEndpoint: endpoint,
    async preflight(record, assertDispatchCurrent, snapshot) {
      assert.deepEqual(snapshot.retained.map(({ hash }) => hash), [first.hash]);
      const selection = await f.store.autoNonceAcceptance.plan({
        ...scope, readPending, assertCurrent: assertDispatchCurrent, snapshot,
      });
      assert.equal(selection.kind, 'ready');
      assert.equal(selection.nonce, record.nonce);
    },
  });
  await next.persistSigned(second);
  assert.equal(await next.dispatchSigned(second, async () => ({ hash: second.hash }), async () => undefined).then((response) => response.hash), second.hash);
  assert.deepEqual(await plan(), { kind: 'ready', nonce: 2, additionalNativeCost: 252246n });
});

test('after reorg, a previously accepted phase needs new pending evidence, including on reopen', async () => {
  const f = fixture(), session = f.session();
  const record = await signed();
  const endpoint = record.context.network.url;
  const lifecycle = createEvmSignedRecordLifecycle(f.store, session, { retirementRead: null, automaticNonceEndpoint: endpoint });
  await lifecycle.persistSigned(record);
  await lifecycle.dispatchSigned(record, async () => record.hash, async () => undefined);
  await f.store.updatePhase(session, record.chainId, record.from, record.hash, 'confirmed');
  await f.store.updatePhase(session, record.chainId, record.from, record.hash, 'submitted');
  const expected = {
    chainId: '0x' + Number(record.chainId).toString(16), from: record.from, hash: record.hash, nonce: '0x0',
    blockHash: null, blockNumber: null, transactionIndex: null,
  };
  for (const journal of [f.store, new EvmSignedRecords(f.port)]) {
    const scope = {
      chainId: record.chainId, from: record.from, endpoint, latest: 0, pending: 0,
      snapshot: await journal.captureAutoNonceSnapshot(session, record.chainId, record.from),
      assertCurrent: session.assertCurrent,
    };
    assert.deepEqual(await journal.autoNonceAcceptance.plan({
      ...scope, readPending: async () => null,
    }), { kind: 'unresolved', nonce: 0 });
    assert.deepEqual(await journal.autoNonceAcceptance.plan({
      ...scope, readPending: async (hash) => {
        assert.equal(hash, record.hash);
        return expected;
      },
    }), { kind: 'ready', nonce: 1, additionalNativeCost: 126123n });
  }
});

test('concurrent automatic sends cannot persist and dispatch competing reviewed nonces', async () => {
  const f = fixture(), session = f.session();
  const candidates = await Promise.all([signed(0, 2, '0x01'), signed(0, 2, '0x02')]);
  const wire: string[] = [];
  const settled = await Promise.allSettled(candidates.map(async (record) => {
    const lifecycle = createEvmSignedRecordLifecycle(f.store, session, { retirementRead: null, automaticNonceEndpoint: record.context.network.url });
    await lifecycle.persistSigned(record);
    return lifecycle.dispatchSigned(record, async () => {
      wire.push(record.hash);
      return record.hash;
    }, async () => undefined);
  }));
  assert.equal(wire.length, 1);
  const losing = settled.find((result) => result.status === 'rejected');
  assert.equal(losing?.reason?.code, 'EVM_SIGNED_RECORD_NONCE_CONFLICT');
  assert.equal(losing?.reason?.recoveryHash, wire[0]);
});


test('unreadable storage and exhausted revision are not local append capacity refusals', async () => {
  const first=await signed(0), next=await signed(1);
  const assertUnbranded = async (f: ReturnType<typeof fixture>) => {
    const session=f.session(), before=f.value(), writes=f.writes();
    const boundary=captureEvmSubmission(next.context,session.assertCurrent,()=>createEvmSignedRecordLifecycle(f.store, session, { retirementRead: null }));
    let broadcasts=0, failure:unknown;
    try {
      await submitSignedEvmTransaction(next.rawTransaction,({admit})=>{broadcasts++;return admit(async()=>next.hash);},boundary,undefined,Transaction.from(next.rawTransaction).unsignedSerialized);
    } catch(error) { failure=error; }
    assert(failure instanceof Error);
    assert.equal(consumeSignedEvmCapacityRefusal(failure,evmSubmissionFailure),false);
    assert.equal(broadcasts,0);
    assert.equal(f.writes(),writes);
    assert.equal(createHash('sha256').update(f.value()!).digest('hex'),createHash('sha256').update(before!).digest('hex'));
  };
  const oversized=fixture(); oversized.replace('x'.repeat(16*1024*1024+1));
  await assertUnbranded(oversized);
  const exhausted=fixture(); await exhausted.store.append(exhausted.session(),first);
  const stored=JSON.parse(exhausted.value()!);
  const plain=await exhausted.session().keyring.decryptPrivateRecord({domain:stored.root.domain,recordId:'manifest',envelope:stored.root});
  const root=JSON.parse(new TextDecoder().decode(plain));plain.fill(0);
  root.revision=Number.MAX_SAFE_INTEGER;stored.revision=root.revision;
  stored.root=await exhausted.session().keyring.encryptPrivateRecord({domain:stored.root.domain,recordId:'manifest',plaintext:new TextEncoder().encode(JSON.stringify(root))});
  exhausted.replace(JSON.stringify(stored));
  assert.equal(await exhausted.store.validate(exhausted.session()),1);
  await assertUnbranded(exhausted);
});
