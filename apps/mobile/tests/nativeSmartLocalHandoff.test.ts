import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSigningHandoffs, captureNativeSigningContinuation, completeNativeSigningOwnerStep, retireNativeSigningHandoff, sameSigningResumeOwner, type LocalSigningResumeScope } from '../src/connections/signingHandoff.ts';
import { snapshotNativeSmartLocalAction } from '../src/smartAccount/localAction.ts';
import type { NativeSmartLocalAction } from '../src/custody/trezorAccounts.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(action: NativeSmartLocalAction = {kind:'operation',intent:{kind:'native-transfer',recipient:'0x'+'11'.repeat(20),amountUnits:'123'}}) {
  const canceled:object[]=[],events:string[]=[],drain=Promise.withResolvers<void>();let live=true,changed=()=>{},eligibility=()=>true;
  const scope:LocalSigningResumeScope={wallet:'wallet',unlockGeneration:1,accountId:'smart:60:0',address:'0x'+'22'.repeat(20),type:'SmartAccount',xpub:'public',registration:'full-network',signing:'public-policy-and-owner',trezor:true};
  const manager=new NativeSigningHandoffs({async cancel(job){canceled.push(job);},changed(){changed();}});
  const handoff=manager.captureLocal({id:'local-original',action,scope,expiresAt:Date.now()+60000,order:0,
    assertCurrent(){if(!live)throw Error('CANCELLED');},eligible:()=>eligibility(),drain:()=>drain.promise,
    retire(){events.push(handoff.isSuspended()?'suspended-before-retire':'unsafe-retire');live=false;},
  }, snapshotNativeSmartLocalAction);
  return {manager,handoff,scope,canceled,events,drain,onChanged(callback:()=>void){changed=callback;},onEligibility(callback:()=>boolean){eligibility=callback;},unlock(){live=true;},async close(){manager.cancelLocal();retireNativeSigningHandoff(handoff);drain.resolve();await manager.retired();}};
}

test('local Suite departure retains only a copied public action, original scope/deadline and distinct origin',async()=>{
  const action:NativeSmartLocalAction={kind:'guardian-policy',draft:{action:'set',guardian:'0x'+'33'.repeat(20),delaySeconds:259200,acknowledgedPendingOperationId:null}};
  const f=fixture(action),job={};
  try{
    const deadline=Date.now()+45000;f.handoff.beforeSuiteOpen(deadline,job)(true);assert(f.manager.background(f.handoff));
    const descriptor=f.manager.localDescriptor(f.handoff.id);assert(descriptor);assert.equal(descriptor.kind,'local-smart');assert.equal(descriptor.expiresAt,deadline);
    assert.deepEqual(f.events,['suspended-before-retire']);assert.equal(f.manager.descriptor(f.handoff.id),null);
    assert.equal('wire' in descriptor,false);assert.equal('binding' in descriptor,false);assert.equal('grant' in descriptor.scope,false);
    assert(Object.isFrozen(descriptor.action));assert(Object.isFrozen(descriptor.action.kind==='guardian-policy'&&descriptor.action.draft));
    assert.equal(sameSigningResumeOwner(descriptor.scope,{...f.scope,unlockGeneration:2}),true);
    let drained=false;const waiting=f.manager.drain(f.handoff.id).then(()=>{drained=true;});await tick();assert.equal(drained,false);f.drain.resolve();await waiting;
  }finally{await f.close();}
});

for(const boundary of ['accepted-signature','failed-launch','unrelated-background','expired-window'] as const)test(`local ${boundary} cannot create a resume descriptor`,async()=>{
  const f=fixture(),now=Date.now;let clock=now();Date.now=()=>clock;
  try{
    if(boundary!=='unrelated-background'){
      const launched=f.handoff.beforeSuiteOpen(clock+45000,{});
      if(boundary==='accepted-signature')f.handoff.beforeSignature();
      else if(boundary==='failed-launch')launched(false);
      else clock+=5001;
    }
    assert.equal(f.manager.background(f.handoff),false);assert.equal(f.manager.localDescriptor(f.handoff.id),null);
  }finally{Date.now=now;await f.close();}
});

test('local scope changes discard only the exact old public job',async()=>{
  const f=fixture(),job={};try{
    f.handoff.beforeSuiteOpen(Date.now()+45000,job);f.manager.background(f.handoff);
    f.manager.revalidateLocal(descriptor=>sameSigningResumeOwner(descriptor.scope,{...f.scope,signing:'different-owner'}));
    await tick();assert.deepEqual(f.canceled,[job]);assert.equal(f.manager.localDescriptor(f.handoff.id),null);
  }finally{await f.close();}
});

test('public action snapshot removes unrelated private constructor fields and keeps only durable SLH key identity',()=>{
  const action={kind:'slh-installation',keyId:'public-key-id',password:'must-not-retain',seed:new Uint8Array([1,2]),privateConstructorState:{key:'secret'}} as const;
  assert.deepEqual(snapshotNativeSmartLocalAction(action),{kind:'slh-installation',keyId:'public-key-id'});
  assert.deepEqual(snapshotNativeSmartLocalAction({kind:'wallet-authenticator',password:'secret'} as NativeSmartLocalAction),{kind:'wallet-authenticator'});
  assert.throws(()=>snapshotNativeSmartLocalAction({kind:'operation',intent:{kind:'authenticator',privateKey:'secret'}} as unknown as NativeSmartLocalAction),/Invalid public/);
});

test('a local public descriptor expires at the original absolute deadline and cannot be revived by unlock',async()=>{
  const f=fixture(),readNow=Date.now;let clock=readNow();Date.now=()=>clock;const job={};
  try{
    const deadline=clock+10000;f.handoff.beforeSuiteOpen(deadline,job);f.manager.background(f.handoff);
    clock=deadline+1;f.unlock();assert.equal(f.manager.localDescriptor(f.handoff.id),null);await assert.rejects(f.manager.drain(f.handoff.id));
    await tick();assert.deepEqual(f.canceled,[job]);
  }finally{Date.now=readNow;await f.close();}
});

test('verified partial outputs transfer privately to one freshly unlocked continuation and retire once', async () => {
  const f=fixture(), outputs=['verified-output'];let retired=0;
  const receipt={retire(){retired++;outputs.length=0;}};
  try {
    assert.equal(captureNativeSigningContinuation(f.handoff,()=>receipt),receipt);
    f.handoff.beforeSuiteOpen(Date.now()+45000,{});assert(f.manager.background(f.handoff));
    const saved=f.manager.localDescriptor(f.handoff.id)!;
    assert(!JSON.stringify(saved).includes('verified-output'));
    assert.throws(()=>captureNativeSigningContinuation(f.handoff,()=>receipt),/REQUEST_EXPIRED/);
    f.unlock();
    f.onChanged(()=>{throw Error('must not notify before caller adoption');});
    const resumed=f.manager.resumeLocal({id:saved.id,scope:{...saved.scope,unlockGeneration:2},expiresAt:saved.expiresAt,order:saved.order,action:saved.action,
      assertCurrent(){},eligible:()=>true,drain:async()=>undefined,retire(){}},snapshotNativeSmartLocalAction,saved);
    assert.equal(f.manager.localDescriptor(saved.id),saved);
    assert.throws(()=>f.manager.resumeLocal({id:saved.id,scope:{...saved.scope,unlockGeneration:2},expiresAt:saved.expiresAt,order:saved.order,action:saved.action,
      assertCurrent(){},eligible:()=>true,drain:async()=>undefined,retire(){}},snapshotNativeSmartLocalAction,saved),/REQUEST_EXPIRED/);
    assert.equal(f.manager.localDescriptor(saved.id),saved);
    f.onChanged(()=>{});f.manager.discard(saved,false);
    assert.equal(f.manager.localDescriptor(saved.id),null);
    assert.equal(captureNativeSigningContinuation(resumed,()=>{throw Error('must transfer existing outputs');}),receipt);
    assert.equal(retired,0);
    retireNativeSigningHandoff(f.handoff);await f.manager.retired();assert.deepEqual(f.canceled,[]);
    retireNativeSigningHandoff(resumed);retireNativeSigningHandoff(resumed);
    await f.manager.retired();assert.deepEqual(f.canceled,[saved.job]);
    assert.equal(retired,1);assert.deepEqual(outputs,[]);
    assert.throws(()=>captureNativeSigningContinuation(resumed,()=>receipt),/REQUEST_EXPIRED/);
  } finally {await f.close();}
});

for(const change of ['scope','generation','deadline','action'] as const)test(`a ${change} mismatch erases suspended outputs instead of reviving them`,async()=>{
  const f=fixture();let retired=0;
  try {
    captureNativeSigningContinuation(f.handoff,()=>({retire(){retired++;}}));
    f.handoff.beforeSuiteOpen(Date.now()+45000,{});f.manager.background(f.handoff);f.unlock();
    const saved=f.manager.localDescriptor(f.handoff.id)!;
    assert.throws(()=>f.manager.resumeLocal({id:saved.id,scope:{...saved.scope,unlockGeneration:change==='generation'?1:2,...(change==='scope'?{wallet:'different'}:{})},
      expiresAt:saved.expiresAt+(change==='deadline'?1:0),order:saved.order,action:change==='action'?{kind:'wallet-authenticator'}:saved.action,
      assertCurrent(){},eligible:()=>true,drain:async()=>undefined,retire(){}},snapshotNativeSmartLocalAction,saved),/REQUEST_EXPIRED/);
    assert.equal(retired,1);assert.equal(f.manager.localDescriptor(saved.id),null);
  } finally {await f.close();}
});

test('a synchronous retirement inside a current guard cannot release a private continuation', async()=>{
  let handoff!:ReturnType<NativeSigningHandoffs['captureLocal']>,retireDuringGuard=false,retired=0;
  const manager=new NativeSigningHandoffs({async cancel(){},changed(){}});
  handoff=manager.captureLocal({id:'guard-retirement',scope:{wallet:'wallet',unlockGeneration:1,accountId:'smart:60:0',address:'0x'+'22'.repeat(20),type:'SmartAccount',xpub:'public',registration:'endpoint',signing:'policy',trezor:true},
    expiresAt:Date.now()+60000,order:0,action:{kind:'wallet-authenticator'},assertCurrent(){if(retireDuringGuard)retireNativeSigningHandoff(handoff);},eligible:()=>true,drain:async()=>undefined,retire(){}},snapshotNativeSmartLocalAction);
  captureNativeSigningContinuation(handoff,()=>({retire(){retired++;}}));retireDuringGuard=true;
  assert.throws(()=>captureNativeSigningContinuation(handoff,()=>{throw Error('must not recreate');}),/REQUEST_EXPIRED/);
  assert.equal(retired,1);
});

test('a verified partial step clears the finished job and only a newly opened Suite step can suspend',async()=>{
  const f=fixture(),oldJob={},nextJob={};
  try{
    f.handoff.beforeSuiteOpen(Date.now()+45000,oldJob);
    completeNativeSigningOwnerStep(f.handoff,false);
    assert.equal(f.manager.background(f.handoff),false);
    f.handoff.beforeSuiteOpen(Date.now()+45000,nextJob);
    assert.equal(f.manager.background(f.handoff),true);
    assert.equal(f.manager.localDescriptor(f.handoff.id)!.job,nextJob);
  }finally{await f.close();}
});

test('the final verified owner step keeps accepted-signature departure terminal',async()=>{
  const f=fixture();
  try{
    f.handoff.beforeSuiteOpen(Date.now()+45000,{});
    completeNativeSigningOwnerStep(f.handoff,true);
    assert.equal(f.manager.background(f.handoff),false);
    assert.throws(()=>f.handoff.beforeSuiteOpen(Date.now()+45000,{}),/REQUEST_EXPIRED/);
    assert.throws(()=>completeNativeSigningOwnerStep(f.handoff,false),/REQUEST_EXPIRED/);
  }finally{await f.close();}
});

test('a reentrant continuation factory cannot install a second unowned capsule',async()=>{
  const f=fixture();let innerCreated=false,outerRetired=0;
  try{
    assert.throws(()=>captureNativeSigningContinuation(f.handoff,()=>{
      assert.throws(()=>captureNativeSigningContinuation(f.handoff,()=>{innerCreated=true;return{retire(){}};}),/REQUEST_EXPIRED/);
      return{retire(){outerRetired++;}};
    }),/REQUEST_EXPIRED/);
    assert.equal(innerCreated,false);assert.equal(outerRetired,1);
    assert.throws(()=>captureNativeSigningContinuation(f.handoff,()=>({retire(){}})),/REQUEST_EXPIRED/);
  }finally{await f.close();}
});

for(const callback of ['retire','throw'] as const)test(`background replacement cannot resurrect ownership after a ${callback} callback`,async()=>{
  const f=fixture();let previousRetired=0,nextRetired=0;
  try{
    captureNativeSigningContinuation(f.handoff,()=>({retire(){previousRetired++;}}));
    f.handoff.beforeSuiteOpen(Date.now()+45000,{});f.manager.background(f.handoff);f.unlock();
    const next=f.manager.captureLocal({id:'next-owner-step',scope:f.scope,expiresAt:Date.now()+60000,order:1,action:{kind:'wallet-authenticator'},
      assertCurrent(){},eligible:()=>true,drain:async()=>undefined,retire(){}},snapshotNativeSmartLocalAction);
    captureNativeSigningContinuation(next,()=>({retire(){nextRetired++;}}));
    next.beforeSuiteOpen(Date.now()+45000,{});
    f.onChanged(()=>{if(callback==='throw')throw Error('observer failed');retireNativeSigningHandoff(next);});
    if(callback==='throw')assert.throws(()=>f.manager.background(next),/observer failed/);
    else assert.equal(f.manager.background(next),false);
    assert.equal(previousRetired,1);assert.equal(nextRetired,1);
    assert.equal(f.manager.localDescriptor(next.id),null);
    assert.throws(()=>captureNativeSigningContinuation(next,()=>({retire(){}})),/REQUEST_EXPIRED/);
  }finally{f.onChanged(()=>{});await f.close();}
});

for(const boundary of [1,2])for(const final of [false,true])test(`eligibility completing an owner at check${boundary} cannot suspend the old job (final${final})`,async()=>{
  const f=fixture();let evaluations=0;
  try{
    f.handoff.beforeSuiteOpen(Date.now()+45000,{});
    f.onEligibility(()=>{if(++evaluations===boundary)completeNativeSigningOwnerStep(f.handoff,final);return true;});
    assert.equal(f.manager.background(f.handoff),false);
    assert.equal(f.manager.localDescriptor(f.handoff.id),null);
  }finally{await f.close();}
});
