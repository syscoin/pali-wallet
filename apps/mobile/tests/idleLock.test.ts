import assert from 'node:assert/strict';
import test from 'node:test';
import { idleMinutes, weakensIdlePolicy } from '../../../source/shared/idleLockPolicy.ts';
import { IdleLock } from '../src/core/idleLock.ts';
import { SecurityPreferences } from '../src/core/securityPreferences.ts';
import { PublicViewLock } from '../src/core/publicViewLock.ts';
import { createSecurityRuntime } from '../src/core/securityRuntime.ts';
import { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { CustodyRuntime } from '../src/custody/types.ts';
import { createTestPrivateAuthentication } from './fixtures/privateAuthentication.ts';
const guard = () => undefined;
function clock() { let now = 0; let timers: (() => void)[] = []; return { now: () => ({ monotonic: now, wall: now }), add: (n: number) => { now += n; }, schedule: ((fn: () => void) => { timers.push(fn); return timers.length; }) as unknown as typeof setTimeout, cancel: (() => undefined) as typeof clearTimeout, fire: () => { const current = timers; timers = []; current.forEach(f => f()); } }; }
function timedIdle(c: ReturnType<typeof clock>) { const idle = new IdleLock(c.now, c.schedule, c.cancel); idle.setPolicy(5); return idle; }
function prefs() { let raw: string | null = null, writes = 0, lost = false; const p = new SecurityPreferences({ get: async () => raw, set: async value => { raw = value; writes++; if (lost) throw Error(); } }); return { p, raw: () => raw, writes: () => writes, corrupt: (value: string) => { raw = value; }, lose: () => { lost = true; } }; }
test('strict shared policy rejects coercion and permits the complete range', () => { for (const n of [0, 5, 55, 120]) assert.equal(idleMinutes(n), n); for (const n of [undefined, null, '5', 1, -1, 5.5, 121, NaN, Infinity]) assert.throws(() => idleMinutes(n)); assert.ok(weakensIdlePolicy(5, 0)); assert.ok(weakensIdlePolicy(5, 120)); assert.equal(weakensIdlePolicy(0, 120), false); });
test('expiry precedes activity; old timers and reentrant guards cannot resurrect or revoke twice', () => { const c = clock(); const idle = timedIdle(c), owner = {}; let locked = 0; idle.begin(owner, () => { locked++; assert.equal(idle.check(owner), false); idle.stop(owner); }); c.add(300000); assert.equal(idle.userActivity(), false); c.fire(); assert.equal(locked, 1); assert.equal(idle.userActivity(), false); idle.begin({}, () => locked++); c.fire(); assert.equal(locked, 1); });
test('real input extends deadline, policy changes do not reset at completion and Off still detects clock rollback', () => { const c = clock(), idle = timedIdle(c); let locks = 0; idle.begin({}, () => locks++); c.add(200000); assert.ok(idle.userActivity()); c.add(200000); c.fire(); assert.equal(locks, 0); c.add(100000); c.fire(); assert.equal(locks, 1); const x = clock(), off = new IdleLock(x.now,x.schedule,x.cancel); off.setPolicy(0); off.begin({},()=>locks++); x.add(999999); assert.ok(off.check()); x.add(-1); assert.equal(off.check(), false); assert.equal(locks, 2); });
test('only explicit absence selects defaults and two modes preserve each other with one-use owned snapshots', async () => { const f = prefs(), initial = await f.p.load(); assert.equal(initial.custodyIdleMinutes,0); assert.equal(f.writes(),0); const saved = await f.p.save(initial,'watch',0,guard); assert.equal(saved.custodyIdleMinutes,0); assert.equal(saved.watchIdleMinutes,0); await assert.rejects(f.p.save(initial,'custody',120,guard)); const other=prefs();await other.p.load();await assert.rejects(other.p.save(saved,'watch',5,guard)); });
test('corruption/raw drift/lost acknowledgement preserve bytes and retire saves until an explicit reread', async () => { for (const kind of ['corrupt','drift','lost']) { const f=prefs(), old=await f.p.load(); if(kind==='corrupt'){f.corrupt('{bad');await assert.rejects(f.p.load());}else if(kind==='drift')f.corrupt('{"version":1,"custodyIdleMinutes":5,"watchIdleMinutes":5}');else f.lose(); await assert.rejects(f.p.save(old,'watch',30,guard)); assert.equal(f.p.getSnapshot().status,'unavailable'); assert.equal(f.writes(),kind==='lost'?1:0); } });
test('async guards are rejected before writing', async()=>{const f=prefs(),s=await f.p.load();await assert.rejects(f.p.save(s,'watch',0,(()=>Promise.reject(Error())) as unknown as ()=>void));assert.equal(f.writes(),0);await new Promise(r=>setImmediate(r));});
test('native weakening is a bounded authority operation with no reusable auth capability', async()=>{
 const f=prefs();let expected=await f.p.load(), auth=0, valid=true; expected=await f.p.save(expected,'custody',5,guard);
 const owner=new AbortController(), authentication=createTestPrivateAuthentication(guard);
 const runtime:CustodyRuntime={security:{isAuthenticating:()=>false,isAuthenticationRefusal:()=>false,async authenticationStatus(){return {deviceAuth:'ready',credentialPresent:true};},async reauthenticateIdlePolicy(signal,scope,check){auth++;check();assert.equal(signal,owner.signal);assert.equal(scope,authentication);}},session:{async createWallet(){},async importWallet(){},async unlock(){return{authenticated:true};},async readSelectedAddress(){return '0x52908400098527886E0F7030069857D2E4169EE7';},async lock(){}},storage:{async readState(){return{presence:'existing',backup:'confirmed'};},async close(){}}};
 const a=new NativeCustodyAuthority({open:async()=>runtime},{preferences:f.p,viewLock:new PublicViewLock({get:async()=>null,set:async()=>undefined}),assertActive(){if(!valid)throw Error();}});await a.initialize();await a.unlock();expected=await a.saveIdlePreference(expected,30,owner.signal,authentication,guard);assert.equal(auth,1);expected=await a.saveIdlePreference(expected,5,owner.signal,authentication,guard);assert.equal(auth,1);valid=false;await assert.rejects(a.saveIdlePreference(expected,0,owner.signal,authentication,guard));assert.equal(auth,1);assert.equal(a.getSnapshot().phase,'locked');
});
test('an unbacked wallet can configure public-view auto-lock while weakening still requires authorization', async () => {
  const f = prefs(), controller = new AbortController();
  let expected = await f.p.load(), authorizations = 0;
  const authentication = createTestPrivateAuthentication(guard);
  const runtime: CustodyRuntime = {
    security: {
      isAuthenticating: () => false, isAuthenticationRefusal: () => false,
      async authenticationStatus() { return { deviceAuth: 'ready', credentialPresent: true }; },
      async reauthenticateIdlePolicy(signal, scope, check) {
        check(); assert.equal(signal, controller.signal); assert.equal(scope, authentication); authorizations++;
      },
    },
    session: {
      async createWallet() {}, async importWallet() {}, async unlock() { return { authenticated: true }; },
      async readSelectedAddress() { return '0x52908400098527886E0F7030069857D2E4169EE7'; }, async lock() {},
    },
    storage: { async readState() { return { presence: 'existing', backup: 'unconfirmed' }; }, async close() {} },
  };
  const authority = new NativeCustodyAuthority({ open: async () => runtime }, {
    preferences: f.p, viewLock: new PublicViewLock({ get: async () => null, set: async () => undefined }), assertActive: guard,
  });
  await authority.initialize(); await authority.unlock();
  assert.equal(authority.getSnapshot().phase, 'ready');
  expected = await authority.saveIdlePreference(expected, 5, controller.signal, authentication, guard);
  assert.equal(expected.custodyIdleMinutes, 5); assert.equal(authorizations, 0);
  expected = await authority.saveIdlePreference(expected, 0, controller.signal, authentication, guard);
  assert.equal(expected.custodyIdleMinutes, 0); assert.equal(authorizations, 1);
  assert.equal(authority.getSnapshot().phase, 'ready');
  await authority.dispose();
});
test('host timer functions retain their required global receiver',()=>{const c=clock();let calls=0;const schedule=function(this:unknown){assert.equal(this,globalThis);calls++;return 1;} as unknown as typeof setTimeout;const cancel=function(this:unknown){assert.equal(this,globalThis);} as typeof clearTimeout;const idle=new IdleLock(c.now,schedule,cancel);idle.setPolicy(5);idle.begin({},()=>assert.fail('valid clock must not expire'));assert.equal(calls,1);assert.ok(idle.check());});
test('concurrent preference saves retire the other compare token without merging modes accidentally',async()=>{const f=prefs(),a=await f.p.load(),b=await f.p.load();const first=f.p.save(a,'custody',30,guard),second=f.p.save(b,'watch',0,guard);await first;await assert.rejects(second);const current=await f.p.load();assert.equal(current.custodyIdleMinutes,30);assert.equal(current.watchIdleMinutes,0);assert.equal(f.writes(),1);});
test('a cancellation during an acknowledged write requires reopen and cannot replay its old token',async()=>{let raw:string|null=null,release!:()=>void,entered!:()=>void,current=true;const started=new Promise<void>(r=>{entered=r;});const held=new Promise<void>(r=>{release=r;});let writes=0;const p=new SecurityPreferences({get:async()=>raw,set:async value=>{writes++;entered();await held;raw=value;}});const before=await p.load();const save=p.save(before,'watch',15,()=>{if(!current)throw Error();});await started;current=false;release();await assert.rejects(save);assert.equal(p.getSnapshot().status,'unavailable');const reopened=await p.load();assert.equal(reopened.watchIdleMinutes,15);await assert.rejects(p.save(before,'watch',0,guard));assert.equal(writes,1);});
test('invalid clock samples lock once even when idle is disabled',()=>{for(const bad of [NaN,Infinity,-1]){let time=0,locks=0;const idle=new IdleLock(()=>({monotonic:time,wall:time}));idle.setPolicy(0);idle.begin({},()=>locks++);time=bad;assert.equal(idle.check(),false);assert.equal(idle.check(),false);assert.equal(locks,1);idle.stop();}});
test('rejected interaction cannot poison a later fresh activation', () => {
 const c=clock(), runtime=createSecurityRuntime({get:async()=>null,set:async()=>undefined},c.now), owner={};
 runtime.watchIdle.setPolicy(5); runtime.watchIdle.begin(owner,()=>runtime.watchIdle.stop(owner)); c.add(300001);
 assert.equal(runtime.beginIdleInteraction(),false);
 runtime.watchIdle.allowNewInput();
 assert.equal(runtime.recordIdleActivity(),true);
 runtime.watchIdle.stop();runtime.custodyIdle.stop();
});
test('captured press cannot act after expiry and rearming the same owner', () => {
 const c=clock(), idle=timedIdle(c), owner={};
 idle.begin(owner,()=>idle.stop(owner)); const press=idle.captureInteraction();
 c.add(300001);assert.equal(press(),false);idle.begin(owner,()=>idle.stop(owner));
 assert.equal(press(),false);assert.equal(idle.captureInteraction()(),true);idle.stop();
});
test('a press begun after the deadline stays rejected after a new input interval', () => {
 const c=clock(), idle=timedIdle(c), owner={};
 idle.begin(owner,()=>idle.stop(owner));c.add(300001);const expiredPress=idle.captureInteraction();
 idle.begin(owner,()=>idle.stop(owner));assert.equal(expiredPress(),false);idle.stop();
});

test('locked-view input reset permits a fresh press but never revives a captured pre-expiry gesture', () => {
  const c = clock(), runtime = createSecurityRuntime({ get: async () => null, set: async () => undefined }, c.now);
  const owner = {};
  runtime.custodyIdle.setPolicy(5);
  runtime.custodyIdle.begin(owner, () => runtime.custodyIdle.stop(owner));
  const previousPress = runtime.captureIdleInteraction();
  c.add(300001); runtime.custodyIdle.check();
  assert.equal(runtime.beginIdleInteraction(), false);
  runtime.custodyIdle.allowNewInput(); runtime.watchIdle.allowNewInput();
  assert.equal(previousPress(), false);
  assert.equal(runtime.captureIdleInteraction()(), true);
  runtime.custodyIdle.begin(owner, () => runtime.custodyIdle.stop(owner));
  c.add(300001); runtime.custodyIdle.allowNewInput();
  assert.equal(runtime.custodyIdle.check(owner), false, 'input reset cannot rearm a still-owned expired timer');
  runtime.custodyIdle.stop(); runtime.watchIdle.stop();
});

test('paused idle ownership retains its original deadline across repeated returns', () => {
  const c = clock(), idle = timedIdle(c), owner = {};
  let locks = 0;
  idle.begin(owner, () => { locks++; idle.stop(owner); });
  c.add(120000);
  let resume = idle.pause(owner); assert(resume);
  c.add(60000); assert(resume());
  idle.begin(owner, () => assert.fail('automatic reopen must not replace the idle owner'));
  c.add(60000); resume = idle.pause(owner); assert(resume);
  c.add(60000); assert.equal(resume(), false);
  assert.equal(locks, 1); assert.equal(idle.check(owner), false);
});

test('pause rejects captured input and cannot restore over a successor or a permanent stop', () => {
  const c = clock(), idle = timedIdle(c), owner = {};
  idle.begin(owner, () => idle.stop(owner));
  const input = idle.captureInteraction(), resume = idle.pause(owner); assert(resume);
  assert.equal(input(), false);
  // A locked-screen gesture is allowed but never resets the paused deadline.
  assert.equal(idle.userActivity(), true);
  c.add(300000); assert.equal(resume(), false); assert.equal(resume(), false);
  idle.begin(owner, () => idle.stop(owner)); const stopped = idle.pause(owner); assert(stopped);
  idle.stop(); assert.equal(stopped(), false);
  idle.begin(owner, () => idle.stop(owner)); const superseded = idle.pause(owner); assert(superseded);
  const next = {}; idle.begin(next, () => idle.stop(next));
  assert.equal(superseded(), false); assert.equal(idle.check(next), true); idle.stop();
});

test('paused Off remains usable but clock rollback still expires it', () => {
  const c = clock(), idle = new IdleLock(c.now, c.schedule, c.cancel), owner = {};
  let locks = 0; idle.setPolicy(0); idle.begin(owner, () => { locks++; idle.stop(owner); });
  c.add(100); let resume = idle.pause(owner); assert(resume);
  c.add(1000000); assert(resume()); assert.equal(locks, 0);
  resume = idle.pause(owner); assert(resume); c.add(-1);
  assert.equal(resume(), false); assert.equal(locks, 1);
});
