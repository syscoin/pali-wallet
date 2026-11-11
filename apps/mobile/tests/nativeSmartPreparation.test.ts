import assert from 'node:assert/strict';
import test from 'node:test';
import { buildECDSAAuthenticator, buildP256WebAuthnAuthenticator, buildSLHDSAAuthenticator } from '../../../source/utils/smartAccount/authenticators.ts';
import { getSLHDSAKeyId, SLH_DSA_SIGNATURE_LIMIT } from '../../../source/utils/slhDsa/constants.ts';
import { getAddress } from '../../../source/utils/ethersV6Compat.ts';
import { buildSmartAccountValidatorSwitch } from '../../../source/utils/smartAccount/validatorSwitch.ts';
import { buildSmartAccountUserOperation, encodeSmartAccountGasFees, encodeSmartAccountGasLimits } from '../../../source/utils/smartAccount/account.ts';
import { NativeSmartPreparationRequests } from '../src/connections/smartPreparationRequests.ts';
import type { NativeSmartPreparationRequest, NativeSmartPreparationReview } from '../src/connections/smartPreparationRequests.ts';
import type { NativeConnectionSigningHost } from '../src/connections/host.ts';
import type { NativeSmartCreationAllocation } from '../src/smartAccount/preparation.ts';
import { NativeSmartAccountOperation, type NativeSmartAccountResolvedIntent, type PreparedSmartAccountOperation } from '../src/smartAccount/operation.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
import type { WalletConnectRequest } from '../src/connections/walletConnect.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import { nativeTranslationFixture, englishI18n } from './localizationFixture.ts';
import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';

const local = '0x1111111111111111111111111111111111111111', external = '0x2222222222222222222222222222222222222222', smart = '0x3333333333333333333333333333333333333333';
const validator = buildECDSAAuthenticator({ chainId: 1, config: { owners: [local], threshold: 1 } }).auth.validator;
const hash = '0x' + 'ab'.repeat(32), t = englishI18n.t.bind(englishI18n);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(options: { passkey?: boolean; slh?: boolean; authentication?: boolean; configured?: boolean; external?: boolean; deployed?: boolean; exact?: boolean; owners?: readonly string[]; corruptTarget?: 'owners' | 'data' | 'validator' } = {}) {
  let promptActive = false, credentialWait: Promise<void> = Promise.resolve();
  let live = true, session = true, selected = 'hd:60:0', deployed = options.deployed ?? false, exact = options.exact ?? false, revision = 0;
  let allocations = 0, preparations = 0, signatures = 0, submissions = 0, metadataReads = 0, savedAccounts = 0;
  let prepareFailures = 0, connectFailures = 0, failMetadata = false, failSignature = false, failResponse = false, dispatchBeforeFailure = false;
  let allocationWait = Promise.resolve(), afterCommitWait = Promise.resolve(), preparationWait = Promise.resolve(), metadataWait = Promise.resolve(), connectWait = Promise.resolve();
  const responses: unknown[] = [], connections: NativeSmartCreationAllocation[] = [], receipts: NativeSmartCreationAllocation[] = [], externalAssents: boolean[] = [];
  const allocationCurrent = () => { assert(live && session && selected === 'smart:60:0', 'ALLOCATION_EXPIRED'); };
  const owner = { order: 1, networkId: 'ethereum', networkLabel: 'Ethereum', chainId: '1',
    assertCurrent() { assert(live && session && selected === 'hd:60:0', 'OWNER_EXPIRED'); }, assertSessionCurrent() { assert(live && session, 'SESSION_EXPIRED'); } };
  const requestedOwners = options.owners ?? (options.external ? [external] : [local]);
  const request: NativeSmartPreparationRequest = { label: 'Requested Smart account', authenticator: options.slh ? { id: 'slh-dsa' } : options.passkey ? { id: 'p256-webauthn' } : options.configured ? { id: 'ecdsa', config: { owners: requestedOwners, threshold: 1 } } : { id: 'ecdsa' } };
  const wire = { id: 10, method: 'wallet_prepareSmartAccount', params: [{}], chainId: 'eip155:1', freshness: 'fresh', expiresAt: Date.now() + 60000,
    session: { binding: { topic: 'topic', origin: 'https://app.example', peerPublicKey: 'ab'.repeat(32) }, metadata: { name: 'Reported application', description: '', url: 'https://reported.example', icons: [] }, expiry: Math.floor(Date.now() / 1000) + 120, namespaces: {} }, verification: { validation: 'UNKNOWN', isScam: false } } as WalletConnectRequest;
  let manager!: NativeSmartPreparationRequests;
  const registration = getNativeNetwork('ethereum');
  const passkey = buildP256WebAuthnAuthenticator({ chainId: 1, config: { publicKey: { x: '0x' + '01'.repeat(32), y: '0x' + '02'.repeat(32), rpIdHash: '0x' + '03'.repeat(32), originHash: '0x' + '04'.repeat(32), originLength: 24 } } });
  const slhPublicKey = { pkRoot: '0x' + '05'.repeat(16) + '00'.repeat(16), pkSeed: '0x' + '06'.repeat(16) + '00'.repeat(16) };
  const slh = buildSLHDSAAuthenticator({ chainId: 1, config: { ...slhPublicKey, keyId: getSLHDSAKeyId(slhPublicKey), parameterSet: 'SLH-DSA-SHA2-128-24', signatureLimit: SLH_DSA_SIGNATURE_LIMIT } });
  const host = {
    context: () => ({ accounts: [{ id: 'hd:60:0', type: 'HDAccount', index: 0, address: local, xpub: local, label: 'Local owner' }], activeAccountId: selected, unlocked: live, networkId: 'ethereum', networkLabel: 'Ethereum',
      network: { chainId: Number(registration.chainId), currency: registration.symbol, kind: 'ethereum' as ReturnType<NativeConnectionSigningHost['context']>['network']['kind'], label: registration.name, slip44: registration.slip44, url: registration.rpcUrl } }),
    async allocateSmartAccount(input, signal, guard, onCommitted, authentication) {
      if (options.authentication) {
        assert(authentication);
        await privateAuthentication.withNativePrivateAuthentication(authentication, signal, guard, async proof => {
          promptActive = true;
          try { await credentialWait; assert(!proof.aborted); guard(); }
          finally { promptActive = false; }
        });
      }
      allocations++; externalAssents.push(input.externalOwnersAcknowledged); guard(); await allocationWait; guard(); assert(!signal.aborted);
      const allocation: NativeSmartCreationAllocation = Object.freeze({ account: { id: 'smart:60:0', index: 0, type: 'SmartAccount' as const, address: smart, xpub: smart, label: input.label }, networkId: 'ethereum', chainId: 1, target: input.target, ...(input.target.id === 'p256-webauthn' ? {targetAuth:passkey.auth} : input.target.id === 'slh-dsa' ? {targetAuth:slh.auth} : {}), assertCurrent: allocationCurrent });
      savedAccounts++; receipts.push(allocation); onCommitted(allocation);
      // An observer may run here while the new private state is not published.
      manager.revalidate(); await afterCommitWait; selected = 'smart:60:0'; guard(); assert(!signal.aborted); return allocation;
    },
    async prepareSmartAccountCreationOperation(allocation, handoff, guard, authentication) {
      preparations++; guard(); await preparationWait; guard(); assert.equal(allocation, receipts[0]);
      assert.throws(() => handoff.beforeSuiteOpen(Date.now() + 1000, {}), /Suite continuation/);
      if (prepareFailures-- > 0) throw Error('Pre-sign canonical read unavailable');
      const target = allocation.target; assert(target.id === 'slh-dsa' || target.id === 'p256-webauthn' || target.id === 'ecdsa' && target.config);
      const config = target.id === 'ecdsa' ? target.config : undefined;
      const source = target.id === 'slh-dsa' && exact ? slh : target.id === 'p256-webauthn' && exact ? passkey : buildECDSAAuthenticator({ chainId: 1, config: exact && config ? { owners: [...config.owners], threshold: config.threshold } : { owners: [local], threshold: 1 } });
      const requested = target.id === 'slh-dsa' ? slh : target.id === 'p256-webauthn' ? passkey : buildECDSAAuthenticator({ chainId: 1, config: { owners: options.corruptTarget === 'owners' ? [...config!.owners].reverse() : [...config!.owners], threshold: config!.threshold } });
      let intent: NativeSmartAccountResolvedIntent = deployed ? { kind: 'authenticator', command: buildSmartAccountValidatorSwitch({ accountAddress: smart, chainId: 1,
        metadata: { chainId: 1, contractVersion: '1', deploymentSalt: '0x00', isDeployed: true, auth: source.auth, ...source.metadata }, target: requested }) } : { kind: 'deploy' };
      if (intent.kind === 'authenticator' && options.corruptTarget === 'data') intent = { ...intent, command: { ...intent.command, target: { ...intent.command.target, data: '0xdead' }, targetModule: { ...intent.command.targetModule, data: '0xdead' } } };
      if (intent.kind === 'authenticator' && options.corruptTarget === 'validator') intent = { ...intent, command: { ...intent.command, target: { ...intent.command.target, validator: external }, targetModule: { ...intent.command.targetModule, address: external } } };
      const executions = intent.kind === 'authenticator' ? intent.command.executions.map(value => ({ ...value })) : [{ target: smart, data: '0x', value: '0x0' }];
      const prepared = { actionHash: hash, executions, userOperation: buildSmartAccountUserOperation({ sender: smart, nonce: '0', callData: '0x',
        accountGasLimits: encodeSmartAccountGasLimits({ callGasLimit: 1, verificationGasLimit: 1 }), gasFees: encodeSmartAccountGasFees({ maxFeePerGas: 2, maxPriorityFeePerGas: 1 }), preVerificationGas: '1' }) } as PreparedSmartAccountOperation;
      return new NativeSmartAccountOperation({ account: smart, network: getNativeNetwork('ethereum'), authorizationExpiresAt: handoff.expiresAt, intent, assertCurrent: guard, background() {},
        async prepare() { guard(); return intent.kind === 'authenticator' && exact ? { kind: 'already-configured' } : { kind: 'authorization', intent, operation: prepared }; },
        async sign(_prepared, _guard, signal) { if (options.authentication) { assert(authentication); await privateAuthentication.withNativePrivateAuthentication(authentication, signal, guard, async proof => { promptActive = true; try { await credentialWait; assert(!proof.aborted); guard(); } finally { promptActive = false; } }); } guard(); handoff.beforeSignature(); signatures++; if (failSignature) throw Error('Uncertain signing outcome'); return '0xsigned'; },
        async submit(_prepared, _signature, _signal, check, reviewPayer, broadcast) {
          await reviewPayer({ purpose: 'submit-operation', transaction: { from: local, to: smart, nonce: '0', value: '0', data: '0x', gasLimit: '1', type: 2, chainId: '1', accessList: [], maxFeePerGas: '2', maxPriorityFeePerGas: '1' }, maximumFeeUnits: '2', maximumTotalUnits: '2', coveredFeeUnits: '0' }, check);
          check(); submissions++; if (intent.kind === 'deploy') deployed = true; else exact = true; broadcast(hash, 'submit-operation'); return hash;
        },
        async refreshMetadata(_signal, check) { metadataReads++; await metadataWait; check(); if (failMetadata) throw Error('Canonical adoption not observed'); },
      });
    },
  } satisfies Pick<NativeConnectionSigningHost, 'context' | 'allocateSmartAccount' | 'prepareSmartAccountCreationOperation'>;
  manager = new NativeSmartPreparationRequests({ host: () => host, foreground: () => true, changed() { revision++; }, checkSite: async () => ({ isBlacklisted: false }),
    bindAuthentication: (scope, check) => privateAuthentication.bindNativePrivateAuthentication(scope, { assertCurrent: check, isPromptActive: () => promptActive }),
    async connect(_wire, allocation, signal, check) {
      check(); connections.push(allocation);
      await new Promise<void>((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(Error('CONNECT_CANCELLED')); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        void connectWait.then(() => { signal.removeEventListener('abort', abort); resolve(); }, reject);
      });
      check(); if (connectFailures-- > 0) throw Error('Connect failed');
    },
    async respond(_wire, response, check, dispatched) { check(); if (dispatchBeforeFailure) dispatched(); if (failResponse) throw Error('Lost response'); dispatched(); responses.push(response); } });
  const review = () => manager.review(revision)!;
  const enqueue = (input = request, order = 1) => manager.enqueue(order === 1 ? wire : { ...wire, id: wire.id + order }, input, { ...owner, order });
  return { manager, enqueue, review, wire, owner, receipts, responses, connections, externalAssents,
    holdCredential(wait: Promise<void>) { credentialWait = wait; },
    counts: () => ({ allocations, preparations, signatures, submissions, metadataReads, savedAccounts }),
    failPrepare(value = 1) { prepareFailures = value; }, failConnect(value = 1) { connectFailures = value; }, failMetadata(value: boolean) { failMetadata = value; },
    failSign() { failSignature = true; }, failRespond(afterDispatch = false) { failResponse = true; dispatchBeforeFailure = afterDispatch; },
    holdAllocation(wait: Promise<void>) { allocationWait = wait; }, holdAfterCommit(wait: Promise<void>) { afterCommitWait = wait; }, holdPreparation(wait: Promise<void>) { preparationWait = wait; }, holdMetadata(wait: Promise<void>) { metadataWait = wait; }, holdConnect(wait: Promise<void>) { connectWait = wait; },
    revoke() { live = false; manager.revalidate(); }, revokeSession() { session = false; manager.revalidate(); }, selectOther() { selected = 'other'; manager.revalidate(); } };
}
async function authorizeAndPay(f: ReturnType<typeof fixture>) {
  const id = f.review().id, work = f.manager.approve(id, true); await tick();
  const review = f.review(); assert(review.operation?.payerReview, JSON.stringify(review));
  assert.equal(f.counts().submissions, review.operation.intent.kind === 'deploy' ? 0 : 1);
  f.manager.confirmPayer(id, review.operation.payerReview.id); await work;
}

test('no-config ECDSA allocation is consent-driven, counterfactual and returns only the shared public result', async () => {
  const f = fixture(); f.enqueue();
  try {
    assert.equal(f.counts().allocations, 0); assert.equal(f.review().requestedAuthenticatorId, 'ecdsa');
    await f.manager.approve(f.review().id, false);
    assert.deepEqual(f.counts(), { allocations: 1, preparations: 0, signatures: 0, submissions: 0, metadataReads: 0, savedAccounts: 1 });
    assert.equal(f.connections[0], f.receipts[0]); assert.deepEqual(f.responses, [{ result: { address: smart, chainId: '0x1' } }]); assert.equal(f.manager.size, 0);
  } finally { await f.manager.dispose(); }
});

test('configured ECDSA reuses one allocation through deployment, authenticator authorization, payer reviews and canonical response', async () => {
  const f = fixture({ configured: true, external: true }); f.enqueue();
  try {
    assert.deepEqual(f.review().externalOwners, [external]);
    await assert.rejects(f.manager.approve(f.review().id, false), /acknowledgement/); assert.equal(f.counts().allocations, 0);
    await f.manager.approve(f.review().id, true); assert.equal(f.review().operation?.intent.kind, 'deploy');
    assert.deepEqual(f.externalAssents, [true]); assert.equal(f.counts().signatures, 0);
    await authorizeAndPay(f); assert.equal(f.review().operation?.intent.kind, 'authenticator'); assert.equal(f.counts().allocations, 1); assert.equal(f.responses.length, 0);
    await authorizeAndPay(f); assert.deepEqual(f.responses, [{ result: { address: smart, chainId: '0x1', installedValidator: validator } }]);
    assert.deepEqual(f.counts(), { allocations: 1, preparations: 2, signatures: 2, submissions: 2, metadataReads: 1, savedAccounts: 1 });
  } finally { await f.manager.dispose(); }
});

for (const id of ['composite', 'custom']) test(`${id} is unavailable before any allocation or fallback`, async () => {
  const f = fixture(); f.enqueue({ label: 'Unsupported', authenticator: { id } });
  try { assert.equal(f.review().error, 'PREPARATION_UNAVAILABLE'); await assert.rejects(async () => f.manager.approve(f.review().id, false)); assert.equal(f.counts().allocations, 0); }
  finally { await f.manager.dispose(); }
});

test('wallet-acquired P256 creation keeps separate deployment and authenticator consent and exact target checks', async () => {
  const f = fixture({ passkey: true }); f.enqueue();
  try {
    assert.equal(f.review().requestedAuthenticatorId, 'p256-webauthn');
    await f.manager.approve(f.review().id, false);
    assert.equal(f.review().operation?.intent.kind, 'deploy');
    await authorizeAndPay(f);
    assert.equal(f.review().operation?.intent.kind, 'authenticator');
    assert.equal(f.responses.length, 0);
    await authorizeAndPay(f);
    assert.equal(f.responses.length, 1); assert.equal(f.connections.length, 1);
    assert.equal(f.counts().allocations, 1); assert.equal(f.counts().signatures, 2);
  } finally { await f.manager.dispose(); }
});

test('wallet-prepared SLH creation keeps deployment, installation and payer approval separate', async () => {
  const f = fixture({ slh: true }); f.enqueue();
  try {
    assert.equal(f.review().requestedAuthenticatorId, 'slh-dsa'); assert.equal(f.counts().allocations, 0);
    await f.manager.approve(f.review().id, false);
    assert.equal(f.review().operation?.intent.kind, 'deploy'); assert.equal(f.counts().signatures, 0);
    await authorizeAndPay(f);
    assert.equal(f.review().operation?.intent.kind, 'authenticator'); assert.equal(f.responses.length, 0);
    await authorizeAndPay(f);
    assert.equal(f.counts().allocations, 1); assert.equal(f.counts().signatures, 2); assert.equal(f.counts().submissions, 2);
    assert.equal(f.connections[0], f.receipts[0]);
    assert.deepEqual(f.responses, [{ result: { address: smart, chainId: '0x1', installedValidator: getAddress(f.receipts[0]!.targetAuth!.validator) } }]);
  } finally { await f.manager.dispose(); }
});

for (const corruptTarget of ['data', 'validator'] as const) test(`SLH creation refuses substituted ${corruptTarget} before signing`, async () => {
  const f = fixture({ slh: true, deployed: true, corruptTarget }); f.enqueue();
  try {
    await assert.rejects(f.manager.approve(f.review().id, false), /Creation target changed/);
    assert.equal(f.counts().signatures, 0); assert.equal(f.counts().submissions, 0); assert.equal(f.connections.length, 0);
  } finally { await f.manager.dispose(); }
});

test('SLH preparation retry reuses its allocation, and cancellation prevents late operation delivery', async () => {
  const f = fixture({ slh: true, deployed: true, exact: true }); f.failPrepare(); f.enqueue();
  try {
    await assert.rejects(f.manager.approve(f.review().id, false), /canonical read/);
    assert.equal(f.review().canRetry, true);
    await f.manager.approve(f.review().id, false);
    assert.equal(f.counts().allocations, 1); assert.equal(f.counts().signatures, 0); assert.equal(f.connections[0], f.receipts[0]);
  } finally { await f.manager.dispose(); }
  const cancelled = fixture({ slh: true }), held = Promise.withResolvers<void>(); cancelled.holdPreparation(held.promise); cancelled.enqueue();
  const work = cancelled.manager.approve(cancelled.review().id, false);
  const rejected = assert.rejects(work, /REQUEST_EXPIRED/);
  await tick();
  const disposing = cancelled.manager.dispose(); held.resolve(); await Promise.all([rejected, disposing]);
  assert.equal(cancelled.counts().allocations, 1); assert.equal(cancelled.counts().signatures, 0); assert.equal(cancelled.connections.length, 0); assert.equal(cancelled.responses.length, 0);
});

for (const corruptTarget of ['data', 'validator'] as const) test(`P256 creation refuses substituted ${corruptTarget} before signing`, async () => {
  const f = fixture({ passkey: true, deployed: true, corruptTarget }); f.enqueue();
  try {
    await assert.rejects(f.manager.approve(f.review().id, false), /Creation target changed/);
    assert.equal(f.counts().signatures, 0); assert.equal(f.connections.length, 0);
  } finally { await f.manager.dispose(); }
});

test('pre-sign read retry keeps the exact receipt, while a connection attempt is terminal', async () => {
  const f = fixture({ configured: true, deployed: true, exact: true }); f.failPrepare(); f.enqueue();
  try {
    await assert.rejects(f.manager.approve(f.review().id, false), /canonical read/); assert(f.review().canRetry); assert.equal(f.counts().allocations, 1);
    f.failConnect(); await assert.rejects(f.manager.approve(f.review().id, false), /Connect failed/); assert.equal(f.review().canRetry, false);
    await assert.rejects(f.manager.approve(f.review().id, false)); await assert.rejects(async () => f.manager.retryMetadata(f.review().id));
    assert.equal(f.counts().allocations, 1); assert.equal(f.connections.length, 1); assert(f.connections.every(receipt => receipt === f.receipts[0]));
    assert.equal(f.counts().signatures, 0); assert.equal(f.counts().submissions, 0); assert.equal(f.responses.length, 0);
  } finally { await f.manager.dispose(); }
});

for (const corruptTarget of ['owners', 'data', 'validator'] as const) test(`configured creation rejects a prepared target with changed ${corruptTarget} before signing`, async () => {
  const f = fixture({ configured: true, deployed: true, owners: [local, external], corruptTarget }); f.enqueue();
  try {
    await assert.rejects(f.manager.approve(f.review().id, true), /Creation target changed/);
    assert.equal(f.counts().allocations, 1); assert.equal(f.counts().signatures, 0); assert.equal(f.counts().submissions, 0); assert.equal(f.connections.length, 0);
  } finally { await f.manager.dispose(); }
});

test('an acknowledged durable commit survives cancellation while disposal waits for its unpublished write', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdAfterCommit(held.promise); f.enqueue();
  let work: Promise<unknown> | undefined;
  try {
    work = f.manager.approve(f.review().id, false).catch(() => undefined); await tick(); assert.equal(f.counts().savedAccounts, 1);
    let disposed = false; const closing = f.manager.dispose().then(() => { disposed = true; }); await tick(); assert.equal(disposed, false);
    held.resolve(); await Promise.all([work, closing]); assert.equal(f.counts().savedAccounts, 1); assert.equal(f.counts().allocations, 1); assert.equal(f.responses.length, 0);
  } finally { held.resolve(); await work; await f.manager.dispose(); }
});

test('request cancellation aborts a never-acknowledged connection and drains without another allocation', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdConnect(held.promise); f.enqueue();
  let work: Promise<unknown> | undefined;
  try {
    work = f.manager.approve(f.review().id, false).catch(() => undefined); await tick(); assert.equal(f.connections.length, 1);
    await f.manager.dispose(); await work;
    assert.equal(f.counts().allocations, 1); assert.equal(f.counts().savedAccounts, 1); assert.equal(f.responses.length, 0);
  } finally { held.resolve(); await work; await f.manager.dispose(); }
});

test('a canonical read failure after proven deployment retries configuration on the same receipt', async () => {
  const f = fixture({ configured: true, external: true }); f.enqueue();
  try {
    await f.manager.approve(f.review().id, true); f.failPrepare();
    await assert.rejects(authorizeAndPay(f), /canonical read/); assert(f.review().canRetry);
    assert.equal(f.counts().signatures, 1); assert.equal(f.counts().submissions, 1);
    await f.manager.approve(f.review().id, false); assert.equal(f.review().operation?.intent.kind, 'authenticator');
    await authorizeAndPay(f); assert.equal(f.counts().allocations, 1); assert.equal(f.counts().signatures, 2); assert.equal(f.counts().submissions, 2); assert.equal(f.responses.length, 1);
  } finally { await f.manager.dispose(); }
});

test('metadata-only retry never repeats owner signatures, payer submissions or allocation', async () => {
  const f = fixture({ configured: true, external: true, deployed: true }); f.failMetadata(true); f.enqueue();
  try {
    await f.manager.approve(f.review().id, true);
    const work = f.manager.approve(f.review().id, false); await tick(); const payer = f.review().operation!.payerReview!; f.manager.confirmPayer(f.review().id, payer.id); await work;
    assert.equal(f.review().operation?.metadataRefresh, 'failed'); assert.equal(f.responses.length, 0);
    const before = f.counts(); f.failMetadata(false); await f.manager.retryMetadata(f.review().id);
    assert.equal(f.counts().signatures, before.signatures); assert.equal(f.counts().submissions, before.submissions); assert.equal(f.counts().allocations, 1); assert.equal(f.responses.length, 1);
  } finally { await f.manager.dispose(); }
});

for (const boundary of ['revoke', 'revokeSession', 'selectOther'] as const) test(`${boundary} retires a saved receipt without recreating it`, async () => {
  const f = fixture({ configured: true }); f.enqueue();
  try {
    await f.manager.approve(f.review().id, false); const id = f.review().id; f[boundary]();
    await assert.rejects(async () => f.manager.approve(id, false)); assert.equal(f.manager.size, 0); assert.equal(f.counts().allocations, 1); assert.equal(f.counts().savedAccounts, 1); assert.equal(f.counts().signatures, 0);
  } finally { await f.manager.dispose(); }
});

for (const afterDispatch of [false, true]) test(`lost response is consumed once even when handedOff=${afterDispatch}`, async () => {
  const f = fixture(); f.failRespond(afterDispatch); f.enqueue();
  try {
    await assert.rejects(f.manager.approve(f.review().id, false), /Lost response/); const review = f.review(); assert.equal(review.error, 'DELIVERY_UNCERTAIN'); assert.equal(review.canRetry, false);
    await assert.rejects(async () => f.manager.approve(review.id, false)); assert.equal(f.counts().allocations, 1); assert.equal(f.connections.length, 1);
  } finally { await f.manager.dispose(); }
});

test('a failed owner-signing attempt exposes no preparation retry or second signing attempt', async () => {
  const f = fixture({ configured: true }); f.failSign(); f.enqueue();
  try {
    await f.manager.approve(f.review().id, false); await assert.rejects(f.manager.approve(f.review().id, false));
    assert.equal(f.review().canRetry, false); assert.equal(f.counts().signatures, 1);
    await assert.rejects(async () => f.manager.approve(f.review().id, false)); assert.equal(f.counts().signatures, 1);
  } finally { await f.manager.dispose(); }
});

test('FIFO and a synchronous double approval admit only the displayed request once', async () => {
  const f = fixture(), held = Promise.withResolvers<void>(); f.holdAllocation(held.promise); f.enqueue(); f.enqueue(undefined, 2);
  let work: Promise<unknown> | undefined;
  try {
    await assert.rejects(async () => f.manager.approve('preparation-2', false)); const first = f.review().id;
    work = f.manager.approve(first, false); await assert.rejects(f.manager.approve(first, false)); held.resolve(); await work;
    assert.equal(f.counts().allocations, 1);
  } finally { held.resolve(); await work; await f.manager.dispose(); }
});

function reviewScreenFixture() {
  const authentication = privateAuthentication.createNativePrivateAuthenticationScope();
  let review: NativeSmartPreparationReview = { id: 'preparation-1', revision: 7, appName: 'Reported app', origin: 'https://app.example', verification: { validation: 'UNKNOWN', isScam: false }, label: 'Requested account', requestedAuthenticatorId: 'ecdsa', networkLabel: 'Ethereum', chainId: '1', expiresAt: Date.now() + 60000, busy: false, error: null, externalOwners: [external], requestedOwners: [external], requestedThreshold: 1, accountAddress: null, operation: null, canRetry: false };
  const actions: unknown[][] = [], events = new Map<string, (...args: any[]) => void>();
  const native = { AppState: { currentState: 'active', addEventListener(name: string, callback: (...args: any[]) => void) { events.set(name, callback); return { remove() { events.delete(name); } }; } }, BackHandler: { addEventListener(_name: string, callback: () => void) { events.set('back', callback); return { remove() {} }; } }, Platform: { OS: 'android' }, StyleSheet: { create: (value: unknown) => value }, View: 'View', Switch: 'Switch' };
  const controller = { isRequestAuthenticating: (id: string) => id === 'preparation-1' && authentication.isAuthenticating(), getSnapshot: () => ({ preparationReview: review }), async approveSmartPreparation(...args: unknown[]) { actions.push(['approve', ...args]); }, async rejectSmartPreparation(...args: unknown[]) { actions.push(['reject', ...args]); }, async confirmSmartPreparationPayer(...args: unknown[]) { actions.push(['payer', ...args]); }, async retrySmartPreparationMetadata(...args: unknown[]) { actions.push(['metadata', ...args]); } };
  const fixture = screenFixture(new URL('../src/screens/NativeSmartPreparationReview.tsx', import.meta.url), 'NativeSmartPreparationReview', {
    'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '../platform/localization': nativeTranslationFixture,
    '../ui': { ...Object.fromEntries(['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map(name => [name, name])), colors: {} }, './DappSiteStatus': { DappSiteStatus: 'Site' }, './NativeSmartAccountOperation': { NativeSmartAccountOperationContent: 'Operation' },
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
  });
  const render = () => screenElements(fixture.render({ review, controller }));
  const checkbox = () => render().find(element => element.type === 'Switch')!;
  const confirm = () => render().find(element => element.type === 'Button' && element.props.title === t('buttons.confirm'))!;
  return { render, checkbox, confirm, actions, authentication, change(value: Partial<NativeSmartPreparationReview>) { review = { ...review, ...value }; }, close: fixture.close,
    event(state: string) { native.AppState.currentState = state; events.get('change')?.(state); }, blur() { events.get('blur')?.(); },
    background() { native.AppState.currentState = 'background'; events.get('change')?.('background'); }, back() { events.get('back')?.(); } };
}

test('creation initial review displays origin/network/target and requires a trusted external-owner checkbox', async () => {
  const f = reviewScreenFixture();
  try {
    const text = f.render().flatMap(element => element.children.filter(child => typeof child === 'string')).join(' ');
    assert(text.includes('https://app.example')); assert(text.includes('Ethereum')); assert(text.includes(external)); assert(text.includes('Requested account'));
    assert(f.confirm().props.disabled); f.confirm().props.onPress(); assert.deepEqual(f.actions, []);
    f.checkbox().props.onValueChange(true); const held = f.confirm().props.onPress; assert.equal(f.confirm().props.disabled, false);
    f.checkbox().props.onValueChange(false); held(); assert.deepEqual(f.actions, []);
    f.checkbox().props.onValueChange(true); f.confirm().props.onPress(); await tick(); assert.deepEqual(f.actions, [['approve', 'preparation-1', 7, true]]);
  } finally { f.close(); }
});

test('stale revision, replacement request, background and unmount revoke held creation callbacks', async () => {
  for (const boundary of ['revision', 'replacement', 'background', 'unmount'] as const) {
    const f = reviewScreenFixture(); f.checkbox().props.onValueChange(true); const held = f.confirm().props.onPress;
    try {
      if (boundary === 'revision') { f.change({ revision: 8 }); f.render(); }
      else if (boundary === 'replacement') { f.change({ id: 'preparation-2' }); f.render(); }
      else if (boundary === 'background') f.background(); else f.close();
      held(); await tick(); assert(!f.actions.some(action => action[0] === 'approve'));
    } finally { f.close(); }
  }
});

test('creation keeps only its own prompt, preserves assent across busy snapshots and passes status to operation content', async () => {
  const f = reviewScreenFixture(), held = Promise.withResolvers<void>();
  const binding = privateAuthentication.bindNativePrivateAuthentication(f.authentication, { assertCurrent() {}, isPromptActive: () => true });
  const proof = privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => {}, () => held.promise);
  try {
    f.checkbox().props.onValueChange(true);
    const press = f.confirm().props.onPress;
    f.event('inactive'); f.blur(); press(); assert.deepEqual(f.actions, []);
    f.change({ revision: 8, busy: true }); f.render();
    f.event('active'); held.resolve(); await proof;
    f.change({ revision: 9, busy: false }); f.confirm().props.onPress(); await tick();
    assert.deepEqual(f.actions, [['approve', 'preparation-1', 9, true]]);
    f.change({ operation: { phase: 'authorize' } as NativeSmartPreparationReview['operation'] });
    const content = f.render().find(node => node.type === 'Operation')!;
    assert.equal(typeof content.props.authentication.isAuthenticating, 'function');
    assert.equal(content.props.authentication.isAuthenticating(), false);
    assert.deepEqual(Object.keys(content.props.authentication), ['isAuthenticating']);
  } finally { held.resolve(); await proof.catch(() => undefined); f.close(); }
});

for (const boundary of ['foreign-prompt', 'background', 'back'] as const) test(`creation ${boundary} still retires assent during an OS prompt`, async () => {
  const f = reviewScreenFixture(), held = Promise.withResolvers<void>();
  const scope = boundary === 'foreign-prompt' ? privateAuthentication.createNativePrivateAuthenticationScope() : f.authentication;
  let promptActive = true;
  const binding = privateAuthentication.bindNativePrivateAuthentication(scope, { assertCurrent() {}, isPromptActive: () => promptActive });
  const proof = privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => {}, () => held.promise);
  try {
    f.checkbox().props.onValueChange(true); const press = f.confirm().props.onPress;
    if (boundary === 'background') promptActive = false;
    if (boundary === 'back') f.back(); else f.event(boundary === 'background' ? 'background' : 'inactive');
    f.event('active'); held.resolve(); await proof; press(); await tick();
    assert.deepEqual(f.actions, [['reject', 'preparation-1']]);
  } finally { held.resolve(); await proof.catch(() => undefined); scope.retire(); f.close(); }
});


test('Smart preparation request keeps one prompt owner across allocation and selected-account transition', async () => {
  const f = fixture({ configured: true, authentication: true }), allocation = Promise.withResolvers<void>(), signing = Promise.withResolvers<void>();
  f.holdCredential(allocation.promise); f.enqueue(); const id = f.review().id;
  try {
    const allocating = f.manager.approve(id, false); await tick();
    assert.equal(f.manager.isRequestAuthenticating(id), true);
    assert.equal(f.manager.isRequestAuthenticating('preparation-other'), false);
    allocation.resolve(); await allocating;
    assert.equal(f.review().operation!.phase, 'authorize');
    assert.equal(f.manager.isRequestAuthenticating(id), false);
    f.holdCredential(signing.promise); const authorizing = f.manager.approve(id, false); await tick();
    assert.equal(f.manager.isRequestAuthenticating(id), true, 'same request remains bound after its admitted account selection');
    signing.resolve(); await tick();
    const payer = f.review().operation!.payerReview; assert(payer); f.manager.confirmPayer(id, payer.id); await authorizing;
    assert.equal(f.manager.isRequestAuthenticating(id), false);
    assert(!JSON.stringify(f.review()).includes('authentication'));
  } finally { allocation.resolve(); signing.resolve(); await f.manager.dispose(); }
});
