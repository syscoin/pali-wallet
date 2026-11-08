import { defaultAbiCoder } from '../ethersV6Compat';
import { signP256WebAuthnActionHash } from '../passkey/authenticator';

import { encodeEcdsaValidatorInitData } from './account';
import {
  signSmartAccountActionHash,
  SmartAccountExternalSignatureRequired,
  type SmartAccountAuthenticatorPorts,
} from './authenticatorDispatch';
import { signSmartAccountActionHash as extensionSign } from './execution';
import { signSmartAccountEcdsaOperation } from './signOperation';
import type {
  ISmartAccountMetadata,
  KeyringAccountType,
} from '../../types/network';

jest.mock('../passkey/authenticator', () => ({
  ...jest.requireActual('../passkey/authenticator'),
  signP256WebAuthnActionHash: jest.fn(),
}));

const digest = `0x${'12'.repeat(32)}`;
const owners = [`0x${'21'.repeat(20)}`, `0x${'22'.repeat(20)}`];
const validators = {
  ecdsa: `0x${'31'.repeat(20)}`,
  passkey: `0x${'32'.repeat(20)}`,
  composite: `0x${'33'.repeat(20)}`,
  slh: `0x${'34'.repeat(20)}`,
  custom: `0x${'35'.repeat(20)}`,
};
const signatures = [`0x${'41'.repeat(65)}`, `0x${'42'.repeat(65)}`];
const localOwners = owners.map((address, id) => ({
  address,
  id,
  type: 'HDAccount' as KeyringAccountType,
}));
function metadata(threshold = 1): ISmartAccountMetadata {
  const data = encodeEcdsaValidatorInitData(owners, threshold);
  return {
    chainId: 57057,
    isDeployed: true,
    auth: { module: 'ecdsa', validator: validators.ecdsa, data },
    installedModules: [
      {
        id: 'ecdsa',
        type: 'validator',
        address: validators.ecdsa,
        data,
        config: { owners, threshold },
      },
    ],
  } as ISmartAccountMetadata;
}
function composite(
  children = [validators.passkey, validators.ecdsa],
  threshold = 2
): ISmartAccountMetadata {
  const value = metadata();
  value.auth = {
    module: 'composite',
    validator: validators.composite,
    data: '0x',
  };
  value.installedModules!.push(
    {
      id: 'p256-webauthn',
      type: 'validator',
      address: validators.passkey,
      config: { credentialId: 'credential', publicKey: {} },
    } as never,
    {
      id: 'composite',
      type: 'validator',
      address: validators.composite,
      config: { childValidators: children, threshold },
    }
  );
  return value;
}
const absent = (): SmartAccountAuthenticatorPorts => ({
  ecdsa: null,
  p256WebAuthn: null,
  slhDsa: null,
});

it.each([false, true])(
  'both host entry points preserve digest, owner order and threshold bytes (hydrated: %s)',
  async (hydrated) => {
    const value = metadata(2);
    const nativeCalls: unknown[] = [],
      extensionCalls: unknown[] = [];
    const localValue = hydrated
      ? value
      : { ...value, installedModules: undefined };
    const native = await signSmartAccountEcdsaOperation({
      metadata: localValue,
      actionHash: digest,
      assertCurrent: jest.fn(),
      findOwner: (address) =>
        localOwners.find((owner) => owner.address === address) ?? null,
      async signOwner(address, actionHash, owner) {
        nativeCalls.push([address, actionHash, owner.id]);
        return signatures[owner.id];
      },
    });
    const extension = await extensionSign({
      smartAccount: value,
      actionHash: digest,
      assertBeforeAuthentication: async () => undefined,
      authenticatorContexts: {
        ecdsa: {
          localOwners,
          async signActionHash({ actionHash, owner }: any) {
            extensionCalls.push([owner.address, actionHash, owner.id]);
            return signatures[owner.id];
          },
        },
      },
    });
    expect(nativeCalls).toEqual(extensionCalls);
    expect(nativeCalls).toEqual(
      owners.map((address, id) => [address, digest, id])
    );
    expect(extension.signature).toBe(native);
    expect(native).toBe(defaultAbiCoder.encode(['bytes[]'], [signatures]));
  }
);

it('local signing uses the canonical active auth data rather than unrelated hydrated module configuration', async () => {
  const value = metadata(2);
  const installed = value.installedModules![0];
  if (installed.id !== 'ecdsa') throw new Error('fixture');
  installed.config = { owners: [owners[1]], threshold: 1 };
  const signOwner = jest.fn(
    async (_address: string, _hash: string, owner: { id: number }) =>
      signatures[owner.id]
  );
  const signature = await signSmartAccountEcdsaOperation({
    metadata: value,
    actionHash: digest,
    assertCurrent: jest.fn(),
    findOwner: (address) =>
      localOwners.find((owner) => owner.address === address) ?? null,
    signOwner,
  });
  expect(
    signOwner.mock.calls.map(([address, hash, owner]) => [
      address,
      hash,
      owner.id,
    ])
  ).toEqual(owners.map((address, id) => [address, digest, id]));
  expect(signature).toBe(defaultAbiCoder.encode(['bytes[]'], [signatures]));
});

it('keeps composite contract order and checks authority before every child', async () => {
  const events: string[] = [];
  const result = await signSmartAccountActionHash({
    smartAccount: composite(),
    actionHash: digest,
    async assertBeforeAuthentication() {
      events.push('check');
    },
    onAuthenticatorSigningStarted: (id) => events.push(`start:${id}`),
    onAuthenticatorSigningResolved: (id) => events.push(`end:${id}`),
    ports: {
      ecdsa: {
        localOwners,
        async signActionHash(request) {
          expect(request.actionHash).toBe(digest);
          events.push('ecdsa');
          return signatures[0];
        },
      },
      p256WebAuthn: {
        async signActionHash(request) {
          expect(request.actionHash).toBe(digest);
          events.push('passkey');
          return { signature: '0xabcd' };
        },
      },
      slhDsa: null,
    },
  });
  expect(events).toEqual([
    'check',
    'start:composite',
    'check',
    'start:p256-webauthn',
    'passkey',
    'end:p256-webauthn',
    'check',
    'start:ecdsa',
    'ecdsa',
    'end:ecdsa',
    'end:composite',
  ]);
  expect(result.signature).toBe(
    defaultAbiCoder.encode(['bytes[]'], [['0xabcd', signatures[0]]])
  );
});

it('extension passkey adapter preserves proof and backup-status delivery', async () => {
  const value = composite();
  value.auth = {
    module: 'p256-webauthn',
    validator: validators.passkey,
    data: '0x',
  };
  const proof = { authenticatorData: '0xab' },
    onBackupStatus = jest.fn();
  jest.mocked(signP256WebAuthnActionHash).mockResolvedValueOnce({
    signature: '0xabcd',
    proof,
    backupStatus: { backedUp: true },
  } as any);
  const result = await extensionSign({
    smartAccount: value,
    actionHash: digest,
    assertBeforeAuthentication: async () => undefined,
    authenticatorContexts: { 'p256-webauthn': { onBackupStatus } },
  });
  expect(result).toEqual({
    signature: '0xabcd',
    proof,
    validator: validators.passkey,
  });
  expect(onBackupStatus).toHaveBeenCalledWith({ backedUp: true });
});

it('requires explicit ports and never falls back to browser authentication', async () => {
  const value = composite();
  value.auth = {
    module: 'p256-webauthn',
    validator: validators.passkey,
    data: '0x',
  };
  await expect(
    signSmartAccountActionHash({
      smartAccount: value,
      actionHash: digest,
      assertBeforeAuthentication: async () => undefined,
      ports: {} as never,
    })
  ).rejects.toThrow('Explicit');
  await expect(
    signSmartAccountActionHash({
      smartAccount: value,
      actionHash: digest,
      assertBeforeAuthentication: async () => undefined,
      ports: absent(),
    })
  ).rejects.toBeInstanceOf(SmartAccountExternalSignatureRequired);
  await expect(
    signSmartAccountEcdsaOperation({
      metadata: value,
      actionHash: digest,
      assertCurrent: jest.fn(),
      findOwner: () => null,
      signOwner: jest.fn(),
    })
  ).rejects.toThrow('interactive');
});

it('does not skip rejected or stale composite child approvals', async () => {
  const ecdsa = jest.fn(),
    failure = new Error('user rejected');
  await expect(
    signSmartAccountActionHash({
      smartAccount: composite(),
      actionHash: digest,
      assertBeforeAuthentication: async () => undefined,
      ports: {
        ...absent(),
        ecdsa: { localOwners, signActionHash: ecdsa },
        p256WebAuthn: {
          signActionHash: async () => {
            throw failure;
          },
        },
      },
    })
  ).rejects.toBe(failure);
  expect(ecdsa).not.toHaveBeenCalled();
  let calls = 0;
  await expect(
    signSmartAccountActionHash({
      smartAccount: composite(),
      actionHash: digest,
      async assertBeforeAuthentication() {
        if (++calls === 3) throw new Error('stale');
      },
      ports: {
        ...absent(),
        ecdsa: { localOwners, signActionHash: ecdsa },
        p256WebAuthn: { signActionHash: async () => ({ signature: '0xab' }) },
      },
    })
  ).rejects.toThrow('stale');
  expect(ecdsa).not.toHaveBeenCalled();
});
