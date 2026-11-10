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
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../../source/types/network.ts';
import {
  NativeOwnerProofReceipts,
  type NativeOwnerProofIdentity,
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

test('non-ECDSA drivers contribute no owner receipts or invented checkpoint state', () => {
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
