import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers/wallet';
import { TypedDataEncoder } from 'ethers/hash';
import { defaultAbiCoder } from '../../../source/utils/ethersV6Compat.ts';
import {
  getSmartAccountSigningPlan,
  signSmartAccountActionHash,
} from '../../../source/utils/smartAccount/authenticatorDispatch.ts';
import { createSmartAccountTypedSigningIntent } from '../../../source/utils/smartAccount/ownerSigningIntent.ts';
import { encodePasskeyWebAuthnProof } from '../../../source/utils/passkey/validation.ts';
import { getSLHDSAKeyId, SLH_DSA_PARAMETER_SET, SLH_DSA_SIGNATURE_LENGTH, SLH_DSA_SIGNATURE_LIMIT } from '../../../source/utils/slhDsa/constants.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../../source/types/network.ts';
import {
  NativeOwnerProofReceipts,
  type NativeOwnerProofIdentity,
  type NativeSlhProofRequest,
} from '../src/smartAccount/ownerProofReceipts.ts';

const wallets = [1, 2, 3, 4].map(
  (value) => new Wallet('0x' + value.toString(16).padStart(64, '0'))
);
const owners: readonly NativeOwnerProofIdentity[] = wallets.map(
  (wallet, id) => ({
    id,
    type: (['Trezor', 'HDAccount', 'Ledger', 'Imported'] as const)[id]!,
    address: wallet.address,
    publicKey: wallet.signingKey.compressedPublicKey,
  })
);
const validator = '0x1111111111111111111111111111111111111111';
const otherValidator = '0x2222222222222222222222222222222222222222';
const composite = '0x3333333333333333333333333333333333333333';
const external = '0x4444444444444444444444444444444444444444';
const smart = '0x5555555555555555555555555555555555555555';
const data = {
  domain: {
    name: 'Pali owner proof fixture',
    version: '1',
    chainId: 1,
    verifyingContract: smart,
  },
  types: { Action: [{ name: 'callHash', type: 'bytes32' }] },
  message: { callHash: '0x' + 'aa'.repeat(32) },
};
const intent = createSmartAccountTypedSigningIntent(
  'user-operation',
  data,
  TypedDataEncoder.hash(data.domain, data.types, data.message)
);
const guard = () => undefined;
const passkeyProof = encodePasskeyWebAuthnProof({
  authenticatorData: '0x' + '01'.repeat(37),
  clientDataJSON: '0x' + '02'.repeat(128),
  typeOffset: 1,
  challengeOffset: 2,
  originOffset: 3,
  r: '0x' + '03'.repeat(32),
  s: '0x' + '04'.repeat(32),
});
const p256: SmartAccountValidatorModule = {
  id: 'p256-webauthn',
  type: 'validator',
  address: external,
  config: {
    publicKey: {
      x: '0x' + '11'.repeat(32),
      y: '0x' + '22'.repeat(32),
      originHash: '0x' + '33'.repeat(32),
      rpIdHash: '0x' + '44'.repeat(32),
      originLength: 25,
    },
  },
};

for (const order of ['first', 'middle', 'last'] as const)
  test(`mixed P256 receipts retain shared child order and reuse admitted proof (${order})`, async () => {
    const first = ecdsa(validator, owners.slice(0, 1)),
      last = ecdsa(otherValidator, owners.slice(0, 1));
    const children =
      order === 'first'
        ? [p256, first, last]
        : order === 'middle'
        ? [first, p256, last]
        : [first, last, p256];
    const outer: SmartAccountValidatorModule = {
      id: 'composite',
      type: 'validator',
      address: composite,
      config: {
        childValidators: children.map((child) => child.address),
        threshold: 3,
      },
    };
    const account = metadata([...children, outer], outer),
      plan = getSmartAccountSigningPlan(account, {
        ecdsa: owners,
        p256WebAuthn: true,
        slhDsa: false,
      });
    assert(plan);
    const receipts = new NativeOwnerProofReceipts({ now: () => 100 }),
      binding = 'exact mixed policy and request';
    const captured = receipts.capture(
      { binding, intent, plan, owners, expiresAt: 1000 },
      guard
    );
    let passkeyCalls = 0,
      ownerCalls = 0;
    const run = async () => {
      let ownerIndex = 0,
        passkeyIndex = 0;
      return signSmartAccountActionHash({
        smartAccount: account,
        actionHash: intent.actionHash,
        async assertBeforeAuthentication() {},
        ports: {
          slhDsa: null,
          ecdsa: {
            localOwners: owners,
            async signActionHash(request) {
              const current = {
                  binding,
                  intent,
                  step: captured.steps[ownerIndex++]!,
                },
                previous = receipts.read(captured.handle, current, guard);
              if (previous) return previous;
              ownerCalls++;
              const signature = wallets[request.owner.id]!.signingKey.sign(
                request.actionHash
              ).serialized;
              receipts.record(captured.handle, current, signature, guard);
              return signature;
            },
          },
          p256WebAuthn: {
            async signActionHash() {
              const current = {
                  binding,
                  intent,
                  step: captured.passkeys[passkeyIndex++]!,
                },
                previous = receipts.readPasskey(
                  captured.handle,
                  current,
                  guard
                );
              if (previous) return { signature: previous };
              passkeyCalls++;
              receipts.recordPasskey(
                captured.handle,
                current,
                passkeyProof,
                guard
              );
              return { signature: passkeyProof };
            },
          },
        },
      });
    };
    const firstResult = await run(),
      secondResult = await run();
    assert.equal(passkeyCalls, 1);
    assert.equal(ownerCalls, 2);
    assert.deepEqual(secondResult, firstResult);
    const slots = defaultAbiCoder.decode(['bytes[]'], firstResult.signature)[0];
    assert.equal(
      slots[children.findIndex((child) => child.id === 'p256-webauthn')],
      passkeyProof
    );
  });

for (const failure of [
  'expired',
  'cancelled',
  'context',
  'config',
  'malformed',
] as const)
  test(`mixed P256 receipts refuse ${failure} reuse`, () => {
    const first = ecdsa(validator, owners.slice(0, 1)),
      outer: SmartAccountValidatorModule = {
        id: 'composite',
        type: 'validator',
        address: composite,
        config: {
          childValidators: [p256.address, first.address],
          threshold: 2,
        },
      };
    const account = metadata([first, p256, outer], outer),
      plan = getSmartAccountSigningPlan(account, {
        ecdsa: owners,
        p256WebAuthn: true,
        slhDsa: false,
      });
    assert(plan);
    let now = 100,
      live = true;
    const check = () => {
      if (!live) throw Error('Cancelled');
    };
    const receipts = new NativeOwnerProofReceipts({ now: () => now });
    const captured = receipts.capture(
        { binding: 'exact', intent, plan, owners, expiresAt: 1000 },
        check
      ),
      request = { binding: 'exact', intent, step: captured.passkeys[0]! };
    if (failure === 'malformed') {
      assert.throws(() =>
        receipts.recordPasskey(captured.handle, request, '0xab', check)
      );
      return;
    }
    receipts.recordPasskey(captured.handle, request, passkeyProof, check);
    if (failure === 'expired') now = 1000;
    if (failure === 'cancelled') live = false;
    const changed =
      failure === 'context'
        ? { ...request, binding: 'different' }
        : failure === 'config'
        ? {
            ...request,
            step: {
              ...request.step,
              config: {
                ...request.step.config,
                publicKey: {
                  ...request.step.config.publicKey,
                  x: '0x' + '99'.repeat(32),
                },
              },
            },
          }
        : request;
    assert.throws(() => receipts.readPasskey(captured.handle, changed, check));
    assert.throws(
      () => receipts.readPasskey(captured.handle, request, guard),
      /retired/
    );
  });
function ecdsa(
  address: string,
  selected = owners,
  threshold = selected.length
): SmartAccountValidatorModule {
  return {
    id: 'ecdsa',
    type: 'validator',
    address,
    config: { owners: selected.map((owner) => owner.address), threshold },
  };
}
function metadata(
  modules: SmartAccountValidatorModule[],
  active = modules[0]!
): ISmartAccountMetadata {
  return {
    chainId: 1,
    contractVersion: '1',
    deploymentSalt: '0x00',
    isDeployed: true,
    auth: { module: active.id, validator: active.address, data: '0x' },
    installedModules: modules,
  };
}
function planFor(account: ISmartAccountMetadata) {
  const plan = getSmartAccountSigningPlan(account, {
    ecdsa: owners,
    p256WebAuthn: false,
    slhDsa: false,
  });
  assert(plan);
  return plan;
}

test('receipts preserve every mixed software and hardware owner in the shared threshold order', () => {
  const account = metadata([ecdsa(validator, owners, 3)]),
    plan = planFor(account);
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 });
  const captured = receipts.capture(
    {
      binding: 'exact request, network, policy and owner identities',
      intent,
      plan,
      owners,
      expiresAt: 1000,
    },
    guard
  );
  assert.deepEqual(
    captured.steps.map((step) => step.owner),
    owners.slice(0, 3)
  );
  assert.deepEqual(
    captured.steps.map((step) => [
      step.ordinal,
      step.childIndex,
      step.validator,
    ]),
    [
      [0, 0, validator],
      [1, 0, validator],
      [2, 0, validator],
    ]
  );
  for (const step of captured.steps) {
    const request = {
      binding: 'exact request, network, policy and owner identities',
      intent,
      step,
    };
    assert.equal(receipts.read(captured.handle, request, guard), null);
    const signature = wallets[step.owner.id]!.signingKey.sign(
      intent.actionHash
    ).serialized;
    receipts.record(captured.handle, request, signature, guard);
    assert.equal(
      receipts.read(captured.handle, request, () => undefined),
      signature
    );
  }
  receipts.retire(captured.handle);
  assert.throws(
    () =>
      receipts.read(
        captured.handle,
        {
          binding: 'exact request, network, policy and owner identities',
          intent,
          step: captured.steps[0]!,
        },
        guard
      ),
    /retired/
  );
});

test('a resumed common collector consumes prior verified proofs and assembles the existing threshold encoding', async () => {
  const account = metadata([ecdsa(validator, owners, 3)]),
    plan = planFor(account),
    binding = 'immutable reviewed UserOperation and plan';
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 });
  const captured = receipts.capture(
    { binding, intent, plan, owners, expiresAt: 1000 },
    guard
  );
  const first = wallets[0]!.signingKey.sign(intent.actionHash).serialized;
  receipts.record(
    captured.handle,
    { binding, intent, step: captured.steps[0]! },
    first,
    guard
  );
  let ordinal = 0;
  const signed: number[] = [];
  const result = await signSmartAccountActionHash({
    smartAccount: account,
    actionHash: intent.actionHash,
    async assertBeforeAuthentication() {},
    ports: {
      p256WebAuthn: null,
      slhDsa: null,
      ecdsa: {
        localOwners: owners,
        async signActionHash(request) {
          const step = captured.steps[ordinal++]!;
          assert.equal(step.owner.address, request.owner.address);
          assert.equal(step.validator, request.validator);
          const current = { binding, intent, step },
            previous = receipts.read(captured.handle, current, guard);
          if (previous) return previous;
          signed.push(request.owner.id);
          const signature = wallets[request.owner.id]!.signingKey.sign(
            request.actionHash
          ).serialized;
          receipts.record(captured.handle, current, signature, guard);
          return signature;
        },
      },
    },
  });
  assert.deepEqual(signed, [1, 2]);
  assert.equal(
    result.signature,
    defaultAbiCoder.encode(
      ['bytes[]'],
      [
        wallets
          .slice(0, 3)
          .map(
            (wallet) => wallet.signingKey.sign(intent.actionHash).serialized
          ),
      ]
    )
  );
  assert.equal(ordinal, 3);
});

test('repeated owners in distinct selected composite children retain distinct ordered occurrences and empty slots', async () => {
  const first = ecdsa(validator, owners.slice(0, 2)),
    second = ecdsa(otherValidator, owners.slice(0, 1));
  const unused: SmartAccountValidatorModule = {
    id: 'custom',
    type: 'validator',
    address: external,
    config: {
      name: 'External child',
      moduleType: 1,
      compositeCompatible: true,
    },
  };
  const outer: SmartAccountValidatorModule = {
    id: 'composite',
    type: 'validator',
    address: composite,
    config: {
      childValidators: [validator, external, otherValidator],
      threshold: 2,
    },
  };
  const account = metadata([first, unused, second, outer], outer),
    plan = planFor(account),
    binding = 'exact composite request';
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 }),
    captured = receipts.capture(
      { binding, intent, plan, owners, expiresAt: 1000 },
      guard
    );
  assert.deepEqual(
    captured.steps.map((step) => [
      step.ordinal,
      step.childIndex,
      step.owner.id,
    ]),
    [
      [0, 0, 0],
      [1, 0, 1],
      [2, 2, 0],
    ]
  );
  let ordinal = 0;
  const recorded: number[] = [];
  const result = await signSmartAccountActionHash({
    smartAccount: account,
    actionHash: intent.actionHash,
    async assertBeforeAuthentication() {},
    ports: {
      p256WebAuthn: null,
      slhDsa: null,
      ecdsa: {
        localOwners: owners,
        async signActionHash(request) {
          const step = captured.steps[ordinal++]!;
          assert.equal(step.validator, request.validator);
          assert.equal(step.owner.id, request.owner.id);
          const signature = wallets[request.owner.id]!.signingKey.sign(
            request.actionHash
          ).serialized;
          receipts.record(
            captured.handle,
            { binding, intent, step },
            signature,
            guard
          );
          recorded.push(step.ordinal);
          return signature;
        },
      },
    },
  });
  const signature = (id: number) =>
    wallets[id]!.signingKey.sign(intent.actionHash).serialized;
  assert.deepEqual(recorded, [0, 1, 2]);
  assert.equal(
    receipts.read(
      captured.handle,
      { binding, intent, step: captured.steps[0]! },
      guard
    ),
    signature(0)
  );
  assert.equal(
    receipts.read(
      captured.handle,
      { binding, intent, step: captured.steps[2]! },
      guard
    ),
    signature(0)
  );
  assert.equal(
    result.signature,
    defaultAbiCoder.encode(
      ['bytes[]'],
      [
        [
          defaultAbiCoder.encode(['bytes[]'], [[signature(0), signature(1)]]),
          '0x',
          signature(0),
        ],
      ]
    )
  );
});

test('capture detaches and freezes public occurrence identities while handles expose no stored proof outputs', () => {
  const account = metadata([ecdsa(validator, owners.slice(0, 1))]),
    source = JSON.parse(
      JSON.stringify({
        binding: 'source context',
        intent,
        plan: planFor(account),
        owners,
        expiresAt: 1000,
      })
    );
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 }),
    captured = receipts.capture(source, guard);
  const request = {
    binding: 'source context',
    intent,
    step: captured.steps[0]!,
  };
  const signature = wallets[0]!.signingKey.sign(intent.actionHash).serialized;
  receipts.record(captured.handle, request, signature, guard);
  source.owners[0].address = smart;
  source.owners[0].publicKey = owners[1]!.publicKey;
  source.plan.authenticators[0].owners[0].address = smart;
  source.expiresAt = 999999;
  source.intent.purpose = 'erc7739-typed-data';
  assert.equal(captured.expiresAt, 1000);
  assert.equal(captured.steps[0]!.owner.address, owners[0]!.address);
  assert(Object.isFrozen(captured));
  assert(Object.isFrozen(captured.handle));
  assert(Object.isFrozen(captured.steps));
  assert(Object.isFrozen(captured.steps[0]));
  assert(Object.isFrozen(captured.steps[0]!.owner));
  assert.deepEqual(Reflect.ownKeys(captured.handle), []);
  assert.deepEqual(Reflect.ownKeys(receipts), []);
  assert(!JSON.stringify(captured).includes(signature));
  assert(!JSON.stringify(receipts).includes(signature));
  assert.equal(receipts.read(captured.handle, request, guard), signature);
});

test('P256 has a separate proof occurrence without an invented ECDSA owner', () => {
  const passkey: SmartAccountValidatorModule = {
    id: 'p256-webauthn',
    type: 'validator',
    address: otherValidator,
    config: {
      credentialId: 'credential',
      publicKey: {
        x: '0x' + '11'.repeat(32),
        y: '0x' + '22'.repeat(32),
        originHash: '0x' + '33'.repeat(32),
        originLength: 25,
        rpIdHash: '0x' + '44'.repeat(32),
      },
    },
  };
  const outer: SmartAccountValidatorModule = {
    id: 'composite',
    type: 'validator',
    address: composite,
    config: { childValidators: [validator, otherValidator], threshold: 2 },
  };
  const account = metadata(
    [ecdsa(validator, owners.slice(0, 1)), passkey, outer],
    outer
  );
  const plan = getSmartAccountSigningPlan(account, {
    ecdsa: owners,
    p256WebAuthn: true,
    slhDsa: false,
  });
  assert(plan);
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 });
  const captured = receipts.capture(
    { binding: 'mixed driver request', intent, plan, owners, expiresAt: 1000 },
    guard
  );
  assert.equal(captured.steps.length, 1);
  assert.equal(captured.steps[0]!.validator, validator);
  assert.equal(captured.passkeys.length, 1);
  assert.equal(captured.passkeys[0]!.validator, otherValidator);
  const passkeyOnly = getSmartAccountSigningPlan(metadata([passkey]), {
    ecdsa: owners,
    p256WebAuthn: true,
    slhDsa: false,
  });
  assert(passkeyOnly);
  assert.throws(
    () =>
      receipts.capture(
        {
          binding: 'passkey only request',
          intent,
          plan: passkeyOnly,
          owners,
          expiresAt: 1000,
        },
        guard
      ),
    /ECDSA owner proof plan/
  );
});

test('UserOperation proof receipts retain the existing request budget for derived typed calldata', () => {
  const large = {
    ...data,
    types: { Action: [{ name: 'callData', type: 'bytes' }] },
    message: { callData: '0x' + 'aa'.repeat(34000) },
  };
  const largeIntent = createSmartAccountTypedSigningIntent(
    'user-operation',
    large,
    TypedDataEncoder.hash(large.domain, large.types, large.message)
  );
  const account = metadata([ecdsa(validator, owners.slice(0, 1))]);
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 });
  const captured = receipts.capture(
    {
      binding: 'large original UserOperation request',
      intent: largeIntent,
      plan: planFor(account),
      owners,
      expiresAt: 1000,
    },
    guard
  );
  const request = {
    binding: 'large original UserOperation request',
    intent: largeIntent,
    step: captured.steps[0]!,
  };
  receipts.record(
    captured.handle,
    request,
    wallets[0]!.signingKey.sign(largeIntent.actionHash).serialized,
    guard
  );
  assert.equal(
    receipts.read(captured.handle, request, guard),
    wallets[0]!.signingKey.sign(largeIntent.actionHash).serialized
  );
});

const slh: Extract<SmartAccountValidatorModule, { id: 'slh-dsa' }> = {
  id: 'slh-dsa', type: 'validator', address: '0x6666666666666666666666666666666666666666',
  config: {
    parameterSet: SLH_DSA_PARAMETER_SET,
    pkRoot: '0x' + '51'.repeat(16) + '00'.repeat(16),
    pkSeed: '0x' + '62'.repeat(16) + '00'.repeat(16),
    signatureLimit: SLH_DSA_SIGNATURE_LIMIT,
    keyId: '',
  },
};
slh.config.keyId = getSLHDSAKeyId(slh.config);
// Public byte fixture only: the private host must validate and commit real signatures before recording.
const slhSignature = '0x' + 'ab'.repeat(SLH_DSA_SIGNATURE_LENGTH);

function slhReceiptFixture(order: 'first' | 'last' = 'first') {
  const eoa = ecdsa(validator, owners.slice(0, 1));
  const children = order === 'first' ? [slh, eoa] : [eoa, slh];
  const outer: SmartAccountValidatorModule = { id: 'composite', type: 'validator', address: composite,
    config: { childValidators: children.map(child => child.address), threshold: children.length } };
  const account = metadata([...children, outer], outer);
  const plan = getSmartAccountSigningPlan(account, { ecdsa: owners, p256WebAuthn: false, slhDsa: true });
  assert(plan);
  let now = 100, live = true;
  const check = () => { if (!live) throw Error('Cancelled'); };
  const receipts = new NativeOwnerProofReceipts({ now: () => now });
  const captured = receipts.capture({ binding: 'bound SLH and Trezor request', intent, plan, owners, expiresAt: 1000 }, check);
  const request: NativeSlhProofRequest = { binding: 'bound SLH and Trezor request', intent, step: captured.slh[0]! };
  return { receipts, captured, request, check, account, setClock(value: number) { now = value; }, cancel() { live = false; } };
}

for (const order of ['first', 'middle', 'last'] as const) test(`shared mixed collector retains each SLH proof once in child order (${order})`, async () => {
  const eoa = ecdsa(validator, owners.slice(0, 1));
  const children = order === 'first' ? [slh, eoa, p256] : order === 'middle' ? [eoa, slh, p256] : [eoa, p256, slh];
  const outer: SmartAccountValidatorModule = { id: 'composite', type: 'validator', address: composite,
    config: { childValidators: children.map(child => child.address), threshold: 3 } };
  const account = metadata([...children, outer], outer);
  const plan = getSmartAccountSigningPlan(account, { ecdsa: owners, p256WebAuthn: true, slhDsa: true });
  assert(plan);
  const receipts = new NativeOwnerProofReceipts({ now: () => 100 });
  const binding = 'same approved action and complete policy';
  const captured = receipts.capture({ binding, intent, plan, owners, expiresAt: 1000 }, guard);
  assert.equal(captured.slh.length, 1);
  let ownerCalls = 0, passkeyCalls = 0, slhCalls = 0;
  const run = () => signSmartAccountActionHash({ smartAccount: account, actionHash: intent.actionHash, async assertBeforeAuthentication() {},
    ports: {
      ecdsa: { localOwners: owners, async signActionHash(request) {
        const current = { binding, intent, step: captured.steps[0]! };
        const previous = receipts.read(captured.handle, current, guard); if (previous) return previous;
        ownerCalls++;
        const signature = wallets[request.owner.id]!.signingKey.sign(request.actionHash).serialized;
        receipts.record(captured.handle, current, signature, guard); return signature;
      } },
      p256WebAuthn: { async signActionHash() {
        const current = { binding, intent, step: captured.passkeys[0]! };
        const previous = receipts.readPasskey(captured.handle, current, guard); if (previous) return { signature: previous };
        passkeyCalls++; receipts.recordPasskey(captured.handle, current, passkeyProof, guard); return { signature: passkeyProof };
      } },
      slhDsa: { signMessageActionHash: null, async signActionHash(request) {
        assert.equal(request.keyId, slh.config.keyId); assert.equal(request.actionHash, intent.actionHash);
        const current = { binding, intent, step: captured.slh[0]! };
        const previous = receipts.readSlh(captured.handle, current, guard); if (previous) return previous;
        slhCalls++; receipts.recordSlh(captured.handle, current, slhSignature, guard); return slhSignature;
      } },
    },
  });
  const first = await run(); assert.deepEqual(await run(), first);
  assert.equal(slhCalls, 1, 'resuming the same action does not consume another SLH signature');
  assert.equal(ownerCalls, 1); assert.equal(passkeyCalls, 1);
  const slots = defaultAbiCoder.decode(['bytes[]'], first.signature)[0];
  assert.equal(slots[children.indexOf(slh)], slhSignature);
  assert(Object.isFrozen(captured.slh)); assert(Object.isFrozen(captured.slh[0]!.config));
  assert(!JSON.stringify(captured).includes(slhSignature));
  receipts.retire(captured.handle);
  assert.throws(() => receipts.readSlh(captured.handle, { binding, intent, step: captured.slh[0]! }, guard), /retired/);
});

test('SLH receipt cannot skip an earlier Trezor proof, overwrite a proof or release one after retirement', () => {
  const pending = slhReceiptFixture('last');
  assert.throws(() => pending.receipts.readSlh(pending.captured.handle, pending.request, pending.check), /order changed/);
  assert.throws(() => pending.receipts.readSlh(pending.captured.handle, pending.request, guard), /retired/);
  const outOfOrderRecord = slhReceiptFixture('last');
  assert.throws(() => outOfOrderRecord.receipts.recordSlh(outOfOrderRecord.captured.handle, outOfOrderRecord.request, slhSignature, outOfOrderRecord.check), /order changed/);
  const repeated = slhReceiptFixture();
  repeated.receipts.recordSlh(repeated.captured.handle, repeated.request, slhSignature.toUpperCase().replace('0X', '0x'), repeated.check);
  assert.equal(repeated.receipts.readSlh(repeated.captured.handle, repeated.request, repeated.check), slhSignature);
  assert.throws(() => repeated.receipts.recordSlh(repeated.captured.handle, repeated.request, slhSignature, repeated.check), /order changed/);
  assert.throws(() => repeated.receipts.readSlh(repeated.captured.handle, repeated.request, guard), /retired/);
});

for (const failure of ['expiry', 'cancel', 'binding', 'purpose', 'child', 'ordinal', 'validator', 'key', 'root', 'seed', 'parameter', 'limit', 'valid-key-change'] as const)
  test(`SLH receipt invalidates its complete prefix on changed ${failure}`, () => {
    const f = slhReceiptFixture(); f.receipts.recordSlh(f.captured.handle, f.request, slhSignature, f.check);
    let request = f.request;
    if (failure === 'expiry') f.setClock(1000);
    if (failure === 'cancel') f.cancel();
    if (failure === 'binding') request = { ...request, binding: 'different action' };
    if (failure === 'purpose') request = { ...request, intent: { ...intent, purpose: 'erc7739-typed-data' } };
    if (failure === 'child') request = { ...request, step: { ...request.step, childIndex: 9 } };
    if (failure === 'ordinal') request = { ...request, step: { ...request.step, ordinal: 1 } };
    if (failure === 'validator') request = { ...request, step: { ...request.step, validator: external } };
    if (['key', 'root', 'seed', 'parameter', 'limit', 'valid-key-change'].includes(failure)) {
      const config = { ...request.step.config };
      if (failure === 'key') config.keyId += '-changed';
      if (failure === 'root') config.pkRoot = '0x' + '71'.repeat(32);
      if (failure === 'seed') config.pkSeed = '0x' + '72'.repeat(32);
      if (failure === 'parameter') config.parameterSet = 'different' as typeof config.parameterSet;
      if (failure === 'limit') config.signatureLimit--;
      if (failure === 'valid-key-change') { config.pkSeed = '0x' + '73'.repeat(16) + '00'.repeat(16); config.keyId = getSLHDSAKeyId(config); }
      request = { ...request, step: { ...request.step, config } };
    }
    assert.throws(() => f.receipts.readSlh(f.captured.handle, request, f.check));
    assert.throws(() => f.receipts.readSlh(f.captured.handle, f.request, guard), /retired/);
  });

for (const access of ['read', 'record'] as const) test(`SLH ${access} rechecks the final authority before exposing or retaining a proof`, () => {
  const measured = slhReceiptFixture(); let checkpoints = 0;
  if (access === 'read') measured.receipts.recordSlh(measured.captured.handle, measured.request, slhSignature, measured.check);
  const count = () => { measured.check(); checkpoints++; };
  if (access === 'read') measured.receipts.readSlh(measured.captured.handle, measured.request, count);
  else measured.receipts.recordSlh(measured.captured.handle, measured.request, slhSignature, count);
  const f = slhReceiptFixture(); let reached = 0;
  if (access === 'read') f.receipts.recordSlh(f.captured.handle, f.request, slhSignature, f.check);
  const retire = () => { f.check(); if (++reached === checkpoints) f.receipts.retire(f.captured.handle); };
  assert.throws(() => access === 'read'
    ? f.receipts.readSlh(f.captured.handle, f.request, retire)
    : f.receipts.recordSlh(f.captured.handle, f.request, slhSignature, retire), /retired|expired/);
  assert.throws(() => f.receipts.readSlh(f.captured.handle, f.request, guard), /retired/);
});

for (const [label, signature] of [
  ['empty', '0x'], ['short', slhSignature.slice(0, -2)], ['oversized', slhSignature + '00'],
  ['non-hex', slhSignature.slice(0, -1) + 'z'],
] as const) test(`SLH receipt refuses ${label} proof bytes and destroys the handle`, () => {
  const f = slhReceiptFixture();
  assert.throws(() => f.receipts.recordSlh(f.captured.handle, f.request, signature, f.check), /Invalid retained SLH proof/);
  assert.throws(() => f.receipts.readSlh(f.captured.handle, f.request, guard), /retired/);
});

test('SLH receipt rejects private configuration fields and accessors without reading them', () => {
  for (const accessor of [false, true]) {
    const f = slhReceiptFixture(); let reads = 0;
    const config = accessor
      ? Object.defineProperty({ ...f.request.step.config }, 'pkRoot', { enumerable: true, get() { reads++; return slh.config.pkRoot; } })
      : { ...f.request.step.config, secretKey: 'never retain this' };
    assert.throws(() => f.receipts.readSlh(f.captured.handle, { ...f.request, step: { ...f.request.step, config } }, f.check), /Invalid owner proof receipt data/);
    assert.equal(reads, 0);
    assert.throws(() => f.receipts.readSlh(f.captured.handle, f.request, guard), /retired/);
  }
});

test('SLH public-key fields are bounded before decoding', () => {
  const f = slhReceiptFixture();
  assert.throws(() => f.receipts.readSlh(f.captured.handle, {
    ...f.request, step: { ...f.request.step, config: { ...f.request.step.config, pkRoot: '0x' + 'aa'.repeat(16_384) } },
  }, f.check), /Invalid SLH proof occurrence/);
  assert.throws(() => f.receipts.readSlh(f.captured.handle, f.request, guard), /retired/);
});
