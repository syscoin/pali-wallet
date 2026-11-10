import assert from 'node:assert/strict';
import test from 'node:test';
import { SignTypedDataVersion } from '@metamask/eth-sig-util';
import { createTrezorHardware } from '@sidhujag/sysweb3-keyring/cjs/trezor-hardware.js';
import { recoverAddress } from 'ethers/transaction';
import { signNativeSmartTrezorOwner } from '../src/hardware/smartOwnerSigning.ts';
import { nativeSmartTrezorDevice } from './nativeSmartTrezorDevice.ts';
import { buildSmartAccountUserOpSigningIntent } from '../../../source/utils/smartAccount/userOperationHash.ts';
import { buildPaliErc7739PersonalSigningIntent, buildPaliErc7739TypedDataRequest } from '../../../source/utils/smartAccount/erc7739.ts';
import { signSmartAccountOwnerIntent } from '../../../source/utils/smartAccount/ownerSigning.ts';
import type { SmartAccountOwnerSigningIntent } from '../../../source/utils/smartAccount/ownerSigningIntent.ts';

const SMART = '0x' + '11'.repeat(20), APP = '0x' + '22'.repeat(20);
type Ports = Parameters<typeof signNativeSmartTrezorOwner>[0];
const deferred = () => Promise.withResolvers<void>();
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function intents(overrides: Partial<Parameters<typeof buildSmartAccountUserOpSigningIntent>[0]> = {}, chainId = 57057): SmartAccountOwnerSigningIntent[] {
  return [
    buildSmartAccountUserOpSigningIntent({
      sender: SMART, nonce: '18446744073709551617',
      initCode: '0x22222222222222222222222222222222222222221234', callData: '0xdeadbeef0102',
      accountGasLimits: '0x000000000000000000000000000249f00000000000000000000000000001d4c0',
      preVerificationGas: '55000', gasFees: '0x0000000000000000000000003b9aca00000000000000000000000002540be400',
      paymasterAndData: '0x', signature: '0x', ...overrides,
    }, chainId),
    buildPaliErc7739PersonalSigningIntent({accountAddress: SMART, chainId: 57057, message: 'Exact Smart personal bytes'}),
    buildPaliErc7739TypedDataRequest({accountAddress: SMART, chainId: 57057, typedData: {
      primaryType: 'Mail', domain: {name: 'Original Dapp', chainId: 10, verifyingContract: APP},
      types: {Mail: [{name: 'text', type: 'string'}]}, message: {text: 'Exact Smart V4 bytes'},
    }}).ownerSigningIntent,
  ];
}
const personal = () => intents()[1]!;

function fixture() {
  const device = nativeSmartTrezorDevice(), index = 1, wallet = device.wallets[index]!;
  const signal = new AbortController(), events: string[] = [];
  let live = true, fences = 0, afterSdk = false, postSdkChecks = 0, cancelBeforeFence = false;
  let afterInit: (() => Promise<void>) | undefined, afterKey: (() => Promise<void>) | undefined;
  let fenceHook: (() => void) | undefined;
  const check = () => {
    if (afterSdk && cancelBeforeFence && ++postSdkChecks === 2) live = false;
    if (!live || signal.signal.aborted) throw new Error('CANCELLED');
  };
  const authority = Object.freeze({signal: signal.signal, assertCurrent: check});
  let signingAuthority: Ports['authority'] = authority;
  const expected = Object.freeze({index, address: wallet.address, publicKey: wallet.signingKey.publicKey});
  const session = device.sessions.start({
    owner: {walletFingerprint: 'aa'.repeat(32), accountId: 'trezor:60:1', accountIndex: index,
      accountAddress: wallet.address, network: {id: 'evm-network', kind: 'evm', chainId: '57057', slip44: 60, registrationHash: 'bb'.repeat(32)}},
    workflow: 'send', expiresAt: Date.now() + 90_000,
    sessionGeneration: device.sessions.advanceSessionGeneration(), assertCurrent: check,
  });
  const sdkWorker = createTrezorHardware(session.host).trezorSigner;
  const worker: Ports['worker'] = {
    async init(guard) {
      events.push('init');
      const result = await sdkWorker.init(guard);
      await afterInit?.();
      return result;
    },
    async getPublicKey(request) {
      events.push('key');
      assert.deepEqual(request, {coin: 'eth', slip44: 60, index});
      const result = await sdkWorker.getPublicKey(request);
      await afterKey?.();
      return result;
    },
    async signTypedData(request, suppliedAuthority) {
      events.push('sign');
      assert.equal(suppliedAuthority, signingAuthority);
      const signature = await sdkWorker.signTypedData(request, suppliedAuthority);
      events.push('sdk-signature');
      afterSdk = true;
      return signature;
    },
  };
  const requestFor = (intent: SmartAccountOwnerSigningIntent): Ports['request'] => {
    assert.equal(intent.representation, 'eip712');
    if (intent.representation !== 'eip712') throw new Error('Expected canonical typed intent');
    return {index, address: wallet.address, data: intent.typedData, version: SignTypedDataVersion.V4};
  };
  const sign = (intent = personal(), overrides: Partial<Ports> = {}) => {
    signingAuthority = overrides.authority ?? authority;
    return signNativeSmartTrezorOwner({
      worker, expected, request: requestFor(intent), actionHash: intent.actionHash, authority,
      beforeSignature() {events.push('fence'); fences++; fenceHook?.();}, ...overrides,
    });
  };
  return {
    device, sdkWorker, session, wallet, expected, authority, events, sign, requestFor,
    fences: () => fences, cancel() {live = false;}, abort() {signal.abort();},
    holdInit(hook: typeof afterInit) {afterInit = hook;}, holdKey(hook: typeof afterKey) {afterKey = hook;},
    expireBeforeFence() {cancelBeforeFence = true;}, onFence(hook: () => void) {fenceHook = hook;},
    async close() {
      await session.retire(async () => {const acknowledge = await sdkWorker.retire(); acknowledge();});
      await device.dispose();
      assert.deepEqual(device.callbackErrors, []);
    },
  };
}

test('real device-only SDK signs canonical UserOp and Smart personal/V4 owner intents without software or selection changes', async () => {
  for (const intent of intents()) {
    const f = fixture(), selectedSmart = Object.freeze({id: 9, type: 'SmartAccount' as const, expectedAddress: SMART});
    const selectedBefore = {...selectedSmart}, expectedBefore = {...f.expected};
    let softwareCalls = 0;
    try {
      const signature = await signSmartAccountOwnerIntent({intent, selectedSmart,
        owner: {id: f.expected.index, address: f.wallet.address, type: 'Trezor'}, authority: f.authority,
        sdk: {ledger: null, rawSign: async () => {softwareCalls++; throw new Error('Software vault must remain unavailable');},
          trezor: {signTypedData: (request, authority) => f.sign(intent, {request, authority})}},
      });
      assert.equal(recoverAddress(intent.actionHash, signature), f.wallet.address);
      assert.equal(softwareCalls, 0);
      assert.deepEqual(selectedSmart, selectedBefore);
      assert.deepEqual(f.expected, expectedBefore);
      assert.equal(f.fences(), 1);
      assert.deepEqual(f.events, ['init', 'key', 'sign', 'sdk-signature', 'fence']);
      assert.deepEqual(f.device.requests.map(request => request.method), ['ethereumGetPublicKey', 'ethereumSignTypedData']);
      for (const request of f.device.requests) assert.equal(request.params.path, "m/44'/60'/0'/0/1");
      const signed = f.device.requests[1]!;
      assert.equal(signed.params.metamask_v4_compat, true);
      assert.equal(signed.params.data.primaryType, intent.representation === 'eip712' && intent.typedData.primaryType);
      assert.equal(f.device.signatures[0]!.signature, signature);
      assert.deepEqual(f.device.accepted, [true, true]);
    } finally {await f.close();}
  }
});

for (const mismatch of ['index', 'request-address', 'saved-public-key', 'derived-address', 'device-public-key'] as const)
  test(`owner ${mismatch} mismatch stops before typed signing and the fence`, async () => {
    const f = fixture(), intent = personal(), request = f.requestFor(intent);
    const overrides: { -readonly [K in keyof Ports]?: Ports[K] } = {};
    if (mismatch === 'index') overrides.request = {...request, index: 0};
    if (mismatch === 'request-address') overrides.request = {...request, address: f.device.wallets[0]!.address};
    if (mismatch === 'saved-public-key') overrides.expected = {...f.expected, publicKey: f.device.wallets[0]!.signingKey.publicKey};
    if (mismatch === 'derived-address') {
      overrides.expected = {...f.expected, address: f.device.wallets[0]!.address};
      overrides.request = {...request, address: overrides.expected.address};
    }
    if (mismatch === 'device-public-key') f.device.wrongKey(1);
    try {
      await assert.rejects(f.sign(intent, overrides), /owner changed|public key changed/);
      assert.equal(f.fences(), 0);
      assert(!f.events.includes('sign'));
      if (mismatch === 'index' || mismatch === 'request-address') assert.deepEqual(f.events, []);
      else assert.deepEqual(f.device.requests.map(entry => entry.method), ['ethereumGetPublicKey']);
    } finally {await f.close();}
  });

for (const proof of ['wrong-proof', 'wrong-action-hash', 'malformed-signature'] as const)
  test(`${proof} cannot reach the usable-signature fence despite a matching callback address`, async () => {
    const f = fixture();
    if (proof === 'wrong-proof') f.device.wrongSignature();
    if (proof === 'malformed-signature') f.device.onBeforeCallback(request => {
      if (request.method === 'ethereumSignTypedData') request.response.payload.signature = '0x1234';
    });
    try {
      const reachesSharedProofCheck = proof === 'wrong-action-hash';
      await assert.rejects(f.sign(personal(), reachesSharedProofCheck ? {actionHash: '0x' + '99'.repeat(32)} : {}),
        reachesSharedProofCheck ? /owner signature is invalid/ : {message: 'Trezor returned an invalid typed-data signature'});
      assert.deepEqual(f.events, reachesSharedProofCheck ? ['init', 'key', 'sign', 'sdk-signature'] : ['init', 'key', 'sign']);
      assert.equal(f.device.requests.filter(request => request.method === 'ethereumSignTypedData').length, 1);
      assert.equal(f.fences(), 0);
    } finally {await f.close();}
  });

for (const phase of ['init', 'key', 'sign', 'pre-fence'] as const)
  test(`cancellation at ${phase} withholds both proof bytes and the fence`, async () => {
    const f = fixture(), entered = deferred(), release = deferred();
    const hold = async () => {entered.resolve(); await release.promise;};
    if (phase === 'init') f.holdInit(hold);
    if (phase === 'key') f.holdKey(hold);
    if (phase === 'sign') f.device.onBeforeCallback(async request => {if (request.method === 'ethereumSignTypedData') await hold();});
    if (phase === 'pre-fence') f.expireBeforeFence();
    try {
      const result = f.sign(), rejection = assert.rejects(result,
        phase === 'sign' ? {code: 'HARDWARE_REQUEST_CANCELLED'} : /CANCELLED/);
      if (phase !== 'pre-fence') {await entered.promise; f.cancel(); release.resolve();}
      await rejection;
      assert.equal(f.fences(), 0);
      if (phase === 'init') assert.deepEqual(f.device.requests, []);
      if (phase === 'key') assert(!f.events.includes('sign'));
      if (phase === 'pre-fence') assert(f.events.includes('sdk-signature'));
    } finally {release.resolve(); await f.close();}
  });

test('abort before init and revocation inside the fence cannot disclose a signature', async () => {
  for (const phase of ['before-init', 'inside-fence'] as const) {
    const f = fixture();
    if (phase === 'before-init') f.abort(); else f.onFence(() => f.abort());
    try {
      await assert.rejects(f.sign(), /CANCELLED/);
      assert.equal(f.fences(), phase === 'inside-fence' ? 1 : 0);
      if (phase === 'before-init') assert.deepEqual(f.events, []);
    } finally {await f.close();}
  }
});

test('asynchronous owner authority is refused before SDK or device access', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.sign(personal(), {authority: {signal: f.authority.signal, assertCurrent: async () => undefined}}), /synchronous/);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.device.requests, []);
    assert.equal(f.fences(), 0);
  } finally {await f.close();}
});

test('actual SDK retirement waits for transport cleanup and returns a checked acknowledgement', async () => {
  const f = fixture(), entered = deferred(), releaseCallback = deferred(), disposing = deferred(), releaseDispose = deferred();
  f.device.onBeforeCallback(async request => {if (request.method === 'ethereumSignTypedData') {entered.resolve(); await releaseCallback.promise;}});
  try {
    const result = f.sign(), rejection = assert.rejects(result, /CANCELLED|cancelled/);
    await entered.promise;
    f.device.onBeforeDispose(async () => {disposing.resolve(); await releaseDispose.promise;});
    let acknowledged = false;
    const retirement = f.session.retire(async () => {
      const acknowledge = await f.sdkWorker.retire();
      acknowledge();
      acknowledged = true;
    });
    await disposing.promise;
    await tick();
    assert.equal(acknowledged, false);
    assert.equal(f.fences(), 0);
    releaseDispose.resolve();
    await Promise.all([retirement, rejection]);
    assert.equal(acknowledged, true);
    releaseCallback.resolve();
    await tick();
    // A retired invocation can retain a bounded public callback for fresh consent.
    assert.equal(f.device.accepted.at(-1), true);
    assert.equal(f.device.sessions.getSnapshot()?.phase, 'response-ready');
    assert.equal(f.fences(), 0);
    assert(!f.events.includes('sdk-signature'));
    assert.deepEqual(f.device.callbackErrors, []);
  } finally {
    releaseCallback.resolve(); releaseDispose.resolve();
    await f.close();
  }
});


for(const change of ['unchanged','nonce','fees','call hash','domain'] as const)test(`fresh owned SDK ${change} replay cannot silently change the original Suite typed request`,async()=>{
  const f=fixture(),entered=deferred(),release=deferred(),original=intents()[0]!;
  let freshWorker:ReturnType<typeof createTrezorHardware>['trezorSigner']|undefined;
  let freshSession:ReturnType<typeof f.device.sessions.resume>|undefined;
  try{
    f.device.onBeforeCallback(async request=>{if(request.method==='ethereumSignTypedData'){entered.resolve();await release.promise;}});
    const signing=f.sign(original),rejected=assert.rejects(signing);
    await entered.promise;const snapshot=f.device.sessions.getSnapshot();assert(snapshot);
    await f.session.retire(async()=>{const retired=await f.sdkWorker.retire();retired();});await rejected;
    release.resolve();await tick();assert.equal(f.device.sessions.getSnapshot()?.phase,'response-ready');assert.equal(f.fences(),0);
    const opens=f.device.urls.length;
    freshSession=f.device.sessions.resume({job:f.session.job,owner:snapshot.owner,sessionGeneration:f.device.sessions.advanceSessionGeneration(),accepted:true,assertCurrent:()=>undefined});
    freshWorker=createTrezorHardware(freshSession.host).trezorSigner;
    await tick();assert.equal(f.device.urls.length,opens);assert.equal(f.fences(),0,'Continue creates no signature without a separate Confirm');
    const replacement=change==='nonce'?intents({nonce:'18446744073709551618'})[0]!:change==='fees'?intents({gasFees:'0x'+'00'.repeat(15)+'02'+'00'.repeat(15)+'05'})[0]!:change==='call hash'?intents({callData:'0xdeadbeef0304'})[0]!:change==='domain'?intents({},57058)[0]!:original;
    let fences=0;const authority={signal:new AbortController().signal,assertCurrent:()=>undefined};
    const result=signNativeSmartTrezorOwner({worker:freshWorker,expected:f.expected,request:f.requestFor(replacement),actionHash:replacement.actionHash,authority,beforeSignature(){fences++;}});
    if(change==='unchanged'){assert.equal(recoverAddress(original.actionHash,await result),f.wallet.address);assert.equal(fences,1);await freshSession.finish();}
    else{await assert.rejects(result);assert.equal(fences,0);await freshSession.cancel();}
    assert.equal(f.device.urls.length,opens);assert.equal(f.device.signatures.length,1,'replay never asks the device to sign changed fields under the old transcript');
    const retired=await freshWorker.retire();retired();freshWorker=undefined;
  }finally{release.resolve();if(freshWorker){const retired=await freshWorker.retire();retired();}await freshSession?.cancel();await f.close();}
});


test('an unsuccessful SDK initialization cannot fall through to key lookup or signing',async()=>{
  const f=fixture();let reads=0,signs=0;
  try{
    await assert.rejects(f.sign(personal(),{worker:{async init(){return false;},async getPublicKey(){reads++;throw Error('Must not read');},async signTypedData(){signs++;throw Error('Must not sign');}}}),/initialization failed/);
    assert.equal(reads,0);assert.equal(signs,0);assert.equal(f.fences(),0);assert.deepEqual(f.device.requests,[]);
  }finally{await f.close();}
});
