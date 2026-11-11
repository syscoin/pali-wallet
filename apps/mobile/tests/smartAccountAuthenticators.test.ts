import assert from 'node:assert/strict';
import test from 'node:test';
import { AbiCoder } from 'ethers/abi';
import { Wallet } from 'ethers/wallet';
import { getAddress } from 'ethers/address';
import { recoverAddress } from 'ethers/transaction';
import { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum.js';
import { KeyringAccountType } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import {
  encodeCompositeValidatorInitData,
  encodeEcdsaValidatorInitData,
  getConfiguredAuthenticatorAddress,
} from '../../../source/utils/smartAccount/account.ts';
import {
  buildHydratedP256WebAuthnAuthenticator,
  buildHydratedSLHDSAAuthenticator,
} from '../../../source/utils/smartAccount/authenticators.ts';
import { SmartAccountExternalSignatureRequired } from '../../../source/utils/smartAccount/authenticatorDispatch.ts';
import { signSmartAccountEcdsaOperation } from '../../../source/utils/smartAccount/signOperation.ts';
import { encodeSmartAccountAuthenticatorSignature } from '../../../source/utils/smartAccount/signature.ts';
import type {
  ISmartAccountMetadata,
  SmartAccountValidatorModule,
} from '../../../source/types/network.ts';
import {
  signNativeSmartAccountActionHash,
  canSignNativeSmartAccountActionHash, getNativeSmartAccountSigningPlan,
  type NativeSmartAccountSigningOwner,
} from '../src/smartAccount/authenticatorSigning.ts';

const CHAIN = 57057;
const HASH = `0x${'12'.repeat(32)}`;
const coder = AbiCoder.defaultAbiCoder();
const moduleAddress = (
  kind: 'ecdsa' | 'composite' | 'p256-webauthn' | 'slh-dsa'
) => getAddress(getConfiguredAuthenticatorAddress(CHAIN, kind));

function fixture() {
  const wallets = [1, 2, 3].map(
    (value) => new Wallet(`0x${value.toString(16).padStart(64, '0')}`)
  );
  const localOwners: NativeSmartAccountSigningOwner[] = wallets.map(
    (wallet, id) => ({
      address: wallet.address,
      id: id === 2 ? 0 : id,
      type: id === 2 ? 'Imported' : 'HDAccount',
    })
  );
  const records = localOwners.map((owner) => ({ ...owner }));
  const accounts = {
    HDAccount: Object.fromEntries(
      records
        .filter((owner) => owner.type === 'HDAccount')
        .map((owner) => [owner.id, owner])
    ),
    Imported: Object.fromEntries(
      records
        .filter((owner) => owner.type === 'Imported')
        .map((owner) => [owner.id, owner])
    ),
    Ledger: {},
    Trezor: {},
  };
  const network = {
    kind: 'ethereum',
    chainId: CHAIN,
    slip44: 60,
    url: 'https://public-fixture.invalid',
    currency: 'ETH',
  };
  const state = {
    accounts,
    activeAccountId: 0,
    activeAccountType: KeyringAccountType.HDAccount,
    activeNetwork: network,
  };
  let live = true,
    retiredReason = 'CANCELLED';
  let beforeSign:
    | ((
        owner: NativeSmartAccountSigningOwner,
        check: () => void
      ) => Promise<void>)
    | undefined;
  let afterSign: (() => Promise<void>) | undefined;
  const calls: {
    owner: NativeSmartAccountSigningOwner;
    digest: string;
    signature: string;
  }[] = [];
  const check = () => {
    if (!live) throw Error(retiredReason);
    if (network.chainId !== CHAIN) throw Error('NETWORK_CHANGED');
    if (state.activeAccountId !== 0) throw Error('ACCOUNT_CHANGED');
  };
  type Sdk = EthereumTransactions<undefined, undefined>;
  type SdkArguments = ConstructorParameters<
    typeof EthereumTransactions<undefined, undefined>
  >;
  // The real SDK receives public fixture state and keys through its normal
  // host ports. No signing method, digest format or signer is replaced.
  const sdk: Sdk = new EthereumTransactions<undefined, undefined>(
    () => network as ReturnType<SdkArguments[0]>,
    (target) => {
      check();
      const index = target
        ? localOwners.findIndex(
            (owner) => owner.id === target.id && owner.type === target.type
          )
        : 0;
      assert(index >= 0);
      const wallet = wallets[index]!;
      return {
        address: wallet.address,
        decryptedPrivateKey: wallet.privateKey,
      };
    },
    () => state as unknown as ReturnType<SdkArguments[2]>,
    undefined,
    undefined,
    () => check,
    null
  );
  const ports = {
    p256WebAuthn: null, slhDsa: null, allowReservedSLHDSASignature: false, accountId: 0,
    localOwners,
    assertCurrent: check,
    assertOwnerCurrent(owner: NativeSmartAccountSigningOwner) {
      check();
      const index = localOwners.findIndex(
        (candidate) =>
          candidate.id === owner.id && candidate.type === owner.type
      );
      if (
        index < 0 ||
        (owner.type === 'Ledger' || owner.type === 'Trezor' ? undefined : accounts[owner.type][owner.id]) !== records[index] ||
        records[index]!.address !== owner.address
      )
        throw Error('OWNER_CHANGED');
    },
    async signOwner(
      address: string,
      digest: string,
      owner: NativeSmartAccountSigningOwner,
      guard: () => void
    ) {
      await beforeSign?.(owner, guard);
      const signature = await sdk.ethSign([address, digest], {
        selectedAccount: {
          id: 0,
          type: KeyringAccountType.HDAccount,
          expectedAddress: wallets[0]!.address,
        },
        targetAccount: {
          id: owner.id,
          type: KeyringAccountType[owner.type],
          expectedAddress: address,
        },
        assertCurrent: guard, signal: new AbortController().signal,
      });
      calls.push({ owner, digest, signature });
      await afterSign?.();
      return signature;
    },
  };
  const ecdsa = (threshold = 1): ISmartAccountMetadata => {
    const owners = localOwners.slice(0, 2).map((owner) => owner.address);
    const data = encodeEcdsaValidatorInitData(owners, threshold);
    return {
      chainId: CHAIN,
      isDeployed: true,
      auth: { module: 'ecdsa', validator: moduleAddress('ecdsa'), data },
      installedModules: [
        {
          id: 'ecdsa',
          type: 'validator',
          address: moduleAddress('ecdsa'),
          data,
          config: { owners, threshold },
        },
      ],
    } as ISmartAccountMetadata;
  };
  const composite = (
    threshold = 1,
    ecdsaFirst = false,
    ownerThreshold = 1
  ): ISmartAccountMetadata => {
    const metadata = ecdsa(ownerThreshold);
    const passkey = buildHydratedP256WebAuthnAuthenticator({
      chainId: CHAIN,
      publicKey: {
        x: `0x${'01'.repeat(32)}`,
        y: `0x${'02'.repeat(32)}`,
        rpIdHash: `0x${'03'.repeat(32)}`,
        originHash: `0x${'04'.repeat(32)}`,
        originLength: 32,
      },
    }).metadata.installedModules![0] as SmartAccountValidatorModule;
    const slh = buildHydratedSLHDSAAuthenticator({
      chainId: CHAIN,
      pkRoot: `0x${'05'.repeat(16)}${'00'.repeat(16)}`,
      pkSeed: `0x${'06'.repeat(16)}${'00'.repeat(16)}`,
    }).metadata.installedModules![0] as SmartAccountValidatorModule;
    const childValidators = ecdsaFirst
      ? [moduleAddress('ecdsa'), passkey.address, slh.address]
      : [passkey.address, moduleAddress('ecdsa'), slh.address];
    const data = encodeCompositeValidatorInitData(childValidators, threshold);
    metadata.auth = {
      module: 'composite',
      validator: moduleAddress('composite'),
      data,
    };
    metadata.installedModules!.push(passkey, slh, {
      id: 'composite',
      type: 'validator',
      address: moduleAddress('composite'),
      data,
      config: { childValidators, threshold },
    });
    return metadata;
  };
  return {
    ports,
    calls,
    localOwners,
    records,
    accounts,
    ecdsa,
    composite,
    retire(reason = 'CANCELLED') {
      live = false;
      retiredReason = reason;
    },
    changeNetwork() {
      network.chainId = CHAIN + 1;
    },
    changeSelectedAccount() {
      state.activeAccountId = 1;
    },
    beforeSign(callback: typeof beforeSign) {
      beforeSign = callback;
    },
    afterSign(callback: typeof afterSign) {
      afterSign = callback;
    },
    sign(metadata: ISmartAccountMetadata) {
      return signNativeSmartAccountActionHash({
        metadata,
        actionHash: HASH,
        ...ports,
      });
    },
  };
}

test('ordinary ECDSA and threshold signatures use the actual owner-bound SDK digest path', async () => {
  for (const threshold of [1, 2]) {
    const f = fixture();
    const metadata = f.ecdsa(threshold);
    // Canonical active auth data still wins over stale installed-module hints.
    const installed = metadata.installedModules![0]!;
    assert.equal(installed.id, 'ecdsa');
    if (installed.id === 'ecdsa')
      installed.config = { owners: [f.localOwners[2]!.address], threshold: 1 };
    const result = await f.sign(metadata);
    assert.equal(result.validator, moduleAddress('ecdsa'));
    assert.deepEqual(
      f.calls.map((call) => call.owner.id),
      threshold === 1 ? [0] : [0, 1]
    );
    for (const call of f.calls)
      assert.equal(recoverAddress(HASH, call.signature), call.owner.address);
    assert.equal(
      result.signature,
      threshold === 1
        ? f.calls[0]!.signature
        : coder.encode(['bytes[]'], [f.calls.map((call) => call.signature)])
    );
  }
});

test('native P256 uses the same selected-validator dispatcher and never opens an ECDSA owner', async () => {
  const f = fixture(), metadata = f.composite();
  const module = metadata.installedModules!.find(module => module.id === 'p256-webauthn')!;
  assert(module.id === 'p256-webauthn');
  metadata.auth = { module: module.id, validator: module.address, data: module.data! };
  const calls: unknown[] = [];
  assert(canSignNativeSmartAccountActionHash(metadata, f.localOwners, { p256WebAuthn: true, slhDsa: false }));
  const result = await signNativeSmartAccountActionHash({ ...f.ports, metadata, actionHash: HASH,
    p256WebAuthn: { async signActionHash(request) { calls.push(request); return { signature: '0xab' }; } },
  });
  assert.deepEqual(calls, [{ actionHash: HASH, credentialId: undefined, expectedCredentialIdHash: undefined, expectedPublicKey: module.config.publicKey }]);
  assert.equal(result.validator, module.address); assert.equal(result.signature, '0xab'); assert.equal(f.calls.length, 0);
});

test('native P256 discards a signature when the request is retired while the OS prompt waits', async () => {
  const f = fixture(), metadata = f.composite();
  const module = metadata.installedModules!.find(module => module.id === 'p256-webauthn')!;
  metadata.auth = { module: 'p256-webauthn', validator: module.address, data: module.data! };
  await assert.rejects(signNativeSmartAccountActionHash({ ...f.ports, metadata, actionHash: HASH,
    p256WebAuthn: { async signActionHash() { await Promise.resolve(); f.retire(); return { signature: '0xab' }; } },
  }), /CANCELLED/);
  assert.equal(f.calls.length, 0);
});

test('the shared collector keeps contract child slots and ECDSA owner thresholds with unavailable siblings', async () => {
  for (const first of [false, true]) {
    const f = fixture();
    const result = await f.sign(f.composite(1, first, 2));
    assert.equal(result.validator, moduleAddress('composite'));
    assert.deepEqual(
      f.calls.map((call) => call.owner.id),
      [0, 1]
    );
    const inner = coder.encode(
      ['bytes[]'],
      [f.calls.map((call) => call.signature)]
    );
    assert.equal(
      result.signature,
      coder.encode(
        ['bytes[]'],
        [first ? [inner, '0x', '0x'] : ['0x', inner, '0x']]
      )
    );
  }
  const f = fixture();
  await assert.rejects(
    f.sign(f.composite(2)),
    SmartAccountExternalSignatureRequired
  );
  assert.equal(
    f.calls.length,
    0,
    'shared planning refuses an unsatisfiable policy before any signer is prompted'
  );
});

test('an imported ECDSA owner retains its explicit SDK account bucket', async () => {
  const f = fixture(),
    owner = f.localOwners[2]!;
  const metadata = f.ecdsa();
  metadata.auth!.data = encodeEcdsaValidatorInitData([owner.address], 1);
  const result = await f.sign(metadata);
  assert.deepEqual(
    f.calls.map((call) => call.owner),
    [owner]
  );
  assert.equal(recoverAddress(HASH, result.signature), owner.address);
});

test('installed validator addresses remain shared metadata rather than a native default-address policy', async () => {
  const f = fixture(),
    metadata = f.ecdsa();
  const alternative = getAddress(`0x${'ab'.repeat(20)}`);
  metadata.auth!.validator = alternative;
  metadata.installedModules![0]!.address = alternative;
  assert.equal((await f.sign(metadata)).validator, alternative);

  const c = fixture(),
    composite = c.composite();
  const first = composite.installedModules![0]!;
  assert(first.id === 'ecdsa');
  first.config = { owners: [c.localOwners[0]!.address], threshold: 1 };
  first.data = encodeEcdsaValidatorInitData(first.config.owners, 1);
  const second = {
    ...first,
    address: alternative,
    config: { owners: [c.localOwners[1]!.address], threshold: 1 },
    data: encodeEcdsaValidatorInitData([c.localOwners[1]!.address], 1),
  };
  composite.installedModules!.push(second);
  const parent = composite.installedModules!.find(
    (module) => module.id === 'composite'
  )!;
  assert(parent.id === 'composite');
  parent.config = {
    childValidators: [second.address, first.address],
    threshold: 2,
  };
  const data = encodeCompositeValidatorInitData(
    parent.config.childValidators,
    2
  );
  parent.data = data;
  composite.auth!.data = data;
  const result = await c.sign(composite);
  assert.deepEqual(
    c.calls.map((call) => call.owner.id),
    [1, 0]
  );
  assert.equal(
    result.signature,
    coder.encode(['bytes[]'], [c.calls.map((call) => call.signature)])
  );
});

test('plain platform authenticators and unknown/custom/mismatched modules never enter the SDK signer', async () => {
  for (const kind of [
    'p256-webauthn',
    'slh-dsa',
    'custom',
    'unknown',
    'wrong-address',
    'wrong-module',
    'wrong-child',
  ] as const) {
    const f = fixture();
    const metadata = f.composite();
    if (kind === 'p256-webauthn' || kind === 'slh-dsa') {
      const module = metadata.installedModules!.find(
        (module) => module.id === kind
      )!;
      metadata.auth = {
        module: kind,
        validator: module.address,
        data: module.data ?? '0x',
      };
    } else if (kind === 'wrong-address')
      metadata.auth!.validator = moduleAddress('ecdsa');
    else if (kind === 'wrong-module') metadata.auth!.module = 'ecdsa';
    else if (kind === 'wrong-child')
      metadata.installedModules![0]!.address = `0x${'ab'.repeat(20)}`;
    else metadata.auth!.module = kind as never;
    await assert.rejects(f.sign(metadata));
    assert.equal(f.calls.length, 0, kind);
  }
});

test('retirement, held SDK cancellation and exact owner replacement suppress further signing or release', async () => {
  for (const mode of [
    'retired',
    'locked',
    'network',
    'account',
    'held-cancel',
    'owner-replaced',
    'held-owner-replaced',
    'after-first',
    'after-owner-replaced',
  ] as const) {
    const f = fixture();
    const metadata = f.composite(1, false, 2);
    if (mode === 'retired') f.retire();
    if (mode === 'locked') f.retire('LOCKED');
    if (mode === 'network') f.changeNetwork();
    if (mode === 'account') f.changeSelectedAccount();
    if (mode === 'held-cancel')
      f.beforeSign(async (_owner, guard) => {
        await Promise.resolve();
        f.retire();
        guard();
      });
    if (mode === 'owner-replaced')
      f.accounts.HDAccount[0] = { ...f.records[0]! };
    if (mode === 'held-owner-replaced')
      f.beforeSign(async (_owner, guard) => {
        await Promise.resolve();
        f.accounts.HDAccount[0] = { ...f.records[0]! };
        guard();
      });
    if (mode === 'after-first')
      f.afterSign(async () => {
        f.retire();
      });
    if (mode === 'after-owner-replaced')
      f.afterSign(async () => {
        f.accounts.HDAccount[0] = { ...f.records[0]! };
      });
    await assert.rejects(
      f.sign(metadata),
      /CANCELLED|LOCKED|NETWORK_CHANGED|ACCOUNT_CHANGED|OWNER_CHANGED/
    );
    assert.equal(
      f.calls.length,
      mode === 'after-first' || mode === 'after-owner-replaced' ? 1 : 0,
      mode
    );
    const before = f.calls.length;
    f.retire();
    await assert.rejects(f.sign(metadata), /CANCELLED/);
    assert.equal(f.calls.length, before);
  }
});

test('rejected authentication and wrong-owner signatures are not skipped as absent composite children', async () => {
  const rejected = fixture();
  rejected.beforeSign(async () => {
    throw Error('USER_REJECTED');
  });
  await assert.rejects(rejected.sign(rejected.composite()), /USER_REJECTED/);
  assert.equal(rejected.calls.length, 0);
  const wrong = fixture();
  const signature = await wrong.sign(wrong.ecdsa());
  const another = fixture();
  await assert.rejects(
    signNativeSmartAccountActionHash({
      metadata: another.ecdsa(2),
      actionHash: HASH,
      ...another.ports,
      async signOwner() {
        return signature.signature;
      },
    }),
    /signature is invalid/
  );
  assert.equal(another.calls.length, 0);
});

test('validator order, thresholds and signing callbacks are captured before asynchronous authentication', async () => {
  const f = fixture();
  const metadata = f.composite(1, false, 2);
  const params = { metadata, actionHash: HASH, ...f.ports };
  f.afterSign(async () => {
    const composite = metadata.installedModules!.find(
      (module) => module.id === 'composite'
    )!;
    const ecdsa = metadata.installedModules!.find(
      (module) => module.id === 'ecdsa'
    )!;
    if (composite.id === 'composite')
      composite.config.childValidators.reverse();
    if (ecdsa.id === 'ecdsa') ecdsa.config.threshold = 1;
    params.signOwner = async () => {
      throw Error('REPLACED_PORT');
    };
    params.actionHash = `0x${'34'.repeat(32)}`;
  });
  const result = await signNativeSmartAccountActionHash(params);
  assert.deepEqual(
    f.calls.map((call) => call.owner.id),
    [0, 1]
  );
  assert(f.calls.every((call) => call.digest === HASH));
  const inner = coder.encode(
    ['bytes[]'],
    [f.calls.map((call) => call.signature)]
  );
  assert.equal(
    result.signature,
    coder.encode(['bytes[]'], [['0x', inner, '0x']])
  );
});

test('async and thenable guards are refused before reaching the SDK signer', async () => {
  for (const field of ['assertCurrent', 'assertOwnerCurrent'] as const)
    for (const guard of [
      async () => undefined,
      () => ({
        then(_resolve: unknown, reject: (error: Error) => void) {
          reject(Error('refused thenable'));
        },
      }),
    ]) {
      const f = fixture();
      await assert.rejects(
        signNativeSmartAccountActionHash({
          metadata: f.ecdsa(),
          actionHash: HASH,
          ...f.ports,
          [field]: guard,
        }),
        /guard must be synchronous/
      );
      assert.equal(f.calls.length, 0);
    }
});

test('configured and unrelated address aliases preserve the original first-owner choice', async () => {
  const f = fixture();
  const localOwners: NativeSmartAccountSigningOwner[] = [
    f.localOwners[0]!,
    {
      ...f.localOwners[0]!,
      address: f.localOwners[0]!.address.toLowerCase(),
      id: 17,
      type: 'Imported',
    },
    f.localOwners[1]!,
    f.localOwners[2]!,
    {
      ...f.localOwners[2]!,
      address: f.localOwners[2]!.address.toLowerCase(),
      id: 19,
      type: 'HDAccount',
    },
  ];
  const result = await signNativeSmartAccountActionHash({
    metadata: f.composite(1, false, 2),
    actionHash: HASH,
    ...f.ports,
    localOwners,
  });
  assert.deepEqual(
    f.calls.map((call) => [call.owner.type, call.owner.id]),
    [
      ['HDAccount', 0],
      ['HDAccount', 1],
    ]
  );
  const inner = coder.encode(
    ['bytes[]'],
    [f.calls.map((call) => call.signature)]
  );
  assert.equal(
    result.signature,
    coder.encode(['bytes[]'], [['0x', inner, '0x']])
  );
});

test('aliases cannot satisfy a missing owner threshold or replace a rejected owner', async () => {
  const f = fixture();
  const localOwners: NativeSmartAccountSigningOwner[] = [
    f.localOwners[0]!,
    { ...f.localOwners[0]!, id: 17, type: 'Imported' },
  ];
  await assert.rejects(
    signNativeSmartAccountActionHash({
      metadata: f.composite(1, false, 2),
      actionHash: HASH,
      ...f.ports,
      localOwners,
    }),
    SmartAccountExternalSignatureRequired
  );
  assert.equal(f.calls.length, 0);
  const visited: number[] = [];
  f.beforeSign(async (owner) => {
    visited.push(owner.id);
    throw Error('USER_REJECTED');
  });
  await assert.rejects(
    signNativeSmartAccountActionHash({
      metadata: f.ecdsa(),
      actionHash: HASH,
      ...f.ports,
      localOwners,
    }),
    /USER_REJECTED/
  );
  assert.deepEqual(visited, [0]);
  await assert.rejects(
    signNativeSmartAccountActionHash({
      metadata: f.ecdsa(),
      actionHash: HASH,
      ...f.ports,
      localOwners: [f.localOwners[0]!, { ...f.localOwners[1]!, id: 0 }],
    }),
    /owner identity changed/
  );
  assert.equal(f.calls.length, 0);
});


test('native capability uses the shared available-port threshold and never advertises absent platform signers or duplicate owners', () => {
  const f = fixture();
  assert(canSignNativeSmartAccountActionHash(f.ecdsa(2), f.localOwners, { p256WebAuthn: false, slhDsa: false }));
  assert(canSignNativeSmartAccountActionHash(f.composite(1, false, 2), f.localOwners, { p256WebAuthn: false, slhDsa: false }));
  assert.equal(canSignNativeSmartAccountActionHash(f.composite(2), f.localOwners, { p256WebAuthn: false, slhDsa: false }), false);
  assert.equal(canSignNativeSmartAccountActionHash(f.composite(1, false, 2), [f.localOwners[0]!, { ...f.localOwners[0]!, id: 17, type: 'Imported' }], { p256WebAuthn: false, slhDsa: false }), false);
  assert.equal(canSignNativeSmartAccountActionHash(f.ecdsa(2), f.localOwners.slice(0, 1), { p256WebAuthn: false, slhDsa: false }), false);
  assert.equal(f.calls.length, 0);
});


for (const threshold of [1, 2]) test(`plain ECDSA configured owner order matches the extension wrapper with inverse inventory (threshold ${threshold})`, async () => {
  const native = fixture(), extension = fixture(), metadata = native.ecdsa(threshold);
  metadata.auth!.data = encodeEcdsaValidatorInitData([native.localOwners[1]!.address, native.localOwners[0]!.address], threshold);
  const result = await native.sign(metadata);
  const expected = await signSmartAccountEcdsaOperation({ metadata, actionHash: HASH,
    findOwner(address) {
      const owner = extension.localOwners.find(candidate => candidate.address === getAddress(address));
      return owner ? { id: owner.id, type: KeyringAccountType[owner.type] } : null;
    },
    assertCurrent: extension.ports.assertCurrent,
    async signOwner(address, digest, selected) {
      const owner = extension.localOwners.find(candidate => candidate.id === selected.id && candidate.type === selected.type && candidate.address === address);
      assert(owner);
      const guard = () => { extension.ports.assertCurrent(); extension.ports.assertOwnerCurrent(owner); };
      return extension.ports.signOwner(address, digest, owner, guard);
    },
  });
  const order = threshold === 1 ? [1] : [1, 0];
  assert.deepEqual(native.calls.map(call => call.owner.id), order);
  assert.deepEqual(extension.calls.map(call => call.owner.id), order);
  assert.equal(result.signature, expected);
  assert.equal(encodeSmartAccountAuthenticatorSignature(result), encodeSmartAccountAuthenticatorSignature({ validator: metadata.auth!.validator, signature: expected }));
});


test('injected SLH uses the same composite collector, configured action and reserved-purpose flag', async () => {
  const f = fixture();
  const seen: unknown[] = [];
  const metadata = f.composite(2);
  const signature = `0x${'09'.repeat(3856)}`;
  const result = await signNativeSmartAccountActionHash({ ...f.ports, metadata, actionHash: HASH,
    slhDsa: { signMessageActionHash: null, async signActionHash(request) {
      assert.deepEqual(f.calls.map(call => call.owner.id), [0]);
      seen.push(request); return signature;
    } },
  });
  assert.equal(seen.length, 1);
  const module = metadata.installedModules!.find(module => module.id === 'slh-dsa')!;
  assert.equal(module.id, 'slh-dsa');
  if (module.id !== 'slh-dsa') assert.fail();
  assert.deepEqual(seen[0], { accountId: 0, actionHash: HASH, allowReservedSignature: false,
    keyId: module.config.keyId, parameterSet: module.config.parameterSet, pkRoot: module.config.pkRoot, pkSeed: module.config.pkSeed });
  assert.equal(result.signature, coder.encode(['bytes[]'], [['0x', f.calls[0]!.signature, signature]]));
  assert(canSignNativeSmartAccountActionHash(metadata, f.localOwners, { p256WebAuthn: false, slhDsa: true }));
});

test('an ECDSA-satisfied composite does not touch an unused injected SLH key', async () => {
  const f = fixture(); let calls = 0;
  const result = await signNativeSmartAccountActionHash({ ...f.ports, metadata: f.composite(1), actionHash: HASH,
    slhDsa: { signMessageActionHash: null, async signActionHash() { calls++; throw Error('Missing unused key'); } },
  });
  assert.equal(calls, 0); assert.equal(f.calls.length, 1);
  assert.equal(result.signature, coder.encode(['bytes[]'], [['0x', f.calls[0]!.signature, '0x']]));
});


test('native ordered plan permits separate ECDSA Trezor owner steps and gates uncheckpointed selected drivers',()=>{
  const f=fixture(), one=f.localOwners.map((owner,index)=>index===0?{...owner,type:'Trezor' as const}:owner);
  assert(canSignNativeSmartAccountActionHash(f.ecdsa(1),one,{p256WebAuthn:false,slhDsa:false}));
  assert(canSignNativeSmartAccountActionHash(f.ecdsa(2),one,{p256WebAuthn:false,slhDsa:false}));
  const two=one.map((owner,index)=>index===1?{...owner,type:'Trezor' as const}:owner);
  assert(canSignNativeSmartAccountActionHash(f.ecdsa(2),two,{p256WebAuthn:false,slhDsa:false}));
  const plan=getNativeSmartAccountSigningPlan(f.ecdsa(2),one,{p256WebAuthn:false,slhDsa:false});assert(plan);
  assert.deepEqual(plan.authenticators[0]!.owners.map(owner=>owner.type),['Trezor','HDAccount']);
  assert(canSignNativeSmartAccountActionHash(f.composite(1,false,2),two,{p256WebAuthn:false,slhDsa:true}),'an unused SLH child does not restrict the selected ECDSA plan');
  assert.equal(canSignNativeSmartAccountActionHash(f.composite(2,false,2),two,{p256WebAuthn:false,slhDsa:true}),false,'selected SLH proofs need a separate resume contract');
  assert(canSignNativeSmartAccountActionHash(f.composite(2,false,2),f.localOwners,{p256WebAuthn:false,slhDsa:true}),'software-only composite signing retains the existing path');
});
