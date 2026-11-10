import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSigningHandoffs, sameSigningResumeOwner, type LocalSigningResumeScope } from '../src/connections/signingHandoff.ts';
import { snapshotNativeSmartLocalAction } from '../src/smartAccount/localAction.ts';
import type { NativeSmartLocalAction } from '../src/custody/trezorAccounts.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(action: NativeSmartLocalAction = {kind:'operation',intent:{kind:'native-transfer',recipient:'0x'+'11'.repeat(20),amountUnits:'123'}}) {
  const canceled:object[]=[],events:string[]=[],drain=Promise.withResolvers<void>();let live=true;
  const scope:LocalSigningResumeScope={wallet:'wallet',unlockGeneration:1,accountId:'smart:60:0',address:'0x'+'22'.repeat(20),type:'SmartAccount',xpub:'public',registration:'full-network',signing:'public-policy-and-owner',trezor:true};
  const manager=new NativeSigningHandoffs({async cancel(job){canceled.push(job);},changed(){}});
  const handoff=manager.captureLocal({id:'local-original',action,scope,expiresAt:Date.now()+60000,order:0,
    assertCurrent(){if(!live)throw Error('CANCELLED');},eligible:()=>true,drain:()=>drain.promise,
    retire(){events.push(handoff.isSuspended()?'suspended-before-retire':'unsafe-retire');live=false;},
  });
  return {manager,handoff,scope,canceled,events,drain,unlock(){live=true;},async close(){manager.cancelLocal();drain.resolve();await manager.retired();}};
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
