jest.mock('./aggregate', () => ({
  ...jest.requireActual('./aggregate'),
  aggregateContractCalls: jest.fn(),
}));

import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { getConfiguredAuthenticatorAddress } from './account';
import { aggregateContractCalls } from './aggregate';
import { buildP256WebAuthnAuthenticator } from './authenticators';
import {
  readSmartAccountValidatorMetadata,
  hasUsableSmartAccountAuthMetadata,
} from './executionMetadata';

describe('shared Smart validator metadata boundary', () => {
  const identity = smartAccountAddressFixture(1);
  beforeEach(() => jest.clearAllMocks());

  it.each(['chain', 'address', 'public-key', 'salt'])(
    'refuses %s substitution before provider access',
    async (field) => {
      const account = {
        ...identity.account,
        smartAccount: { ...identity.account.smartAccount },
      };
      let chainId = 1;
      if (field === 'chain') chainId = 57;
      if (field === 'address') account.address = `0x${'aa'.repeat(20)}`;
      if (field === 'public-key') account.xpub = `0x${'aa'.repeat(20)}`;
      if (field === 'salt')
        account.smartAccount.deploymentSalt = `0x${'00'.repeat(32)}`;
      const provider = { getCode: jest.fn(), call: jest.fn() };
      await expect(
        readSmartAccountValidatorMetadata({
          account,
          chainId,
          provider,
          assertCurrent: jest.fn(),
        })
      ).rejects.toThrow('could not be verified');
      expect(provider.getCode).not.toHaveBeenCalled();
      expect(aggregateContractCalls).not.toHaveBeenCalled();
    }
  );

  it('rechecks authority after a held metadata read', async () => {
    let current = true;
    const provider = { getCode: jest.fn(async () => '0x'), call: jest.fn() };
    (aggregateContractCalls as jest.Mock).mockImplementation(async () => {
      current = false;
      return [];
    });
    await expect(
      readSmartAccountValidatorMetadata({
        account: identity.account,
        chainId: 1,
        provider,
        assertCurrent() {
          if (!current) throw new Error('owner ended');
        },
      })
    ).rejects.toThrow('owner ended');
  });

  it('only treats the configured installed validator as usable cached auth', () => {
    const metadata = identity.account.smartAccount;
    expect(hasUsableSmartAccountAuthMetadata(metadata)).toBe(false);
    expect(
      hasUsableSmartAccountAuthMetadata({
        ...metadata,
        installedModules: [
          {
            id: 'ecdsa',
            config: {
              owners: ['0x0000000000000000000000000000000000000001'],
              threshold: 1,
            },
            type: 'validator',
            address: metadata.auth!.validator,
            data: metadata.auth!.data,
          },
        ],
      })
    ).toBe(true);
  });

  const publicKey = {
    x: '0x' + '01'.repeat(32),
    y: '0x' + '02'.repeat(32),
    rpIdHash: '0x' + '03'.repeat(32),
    originHash: '0x' + '04'.repeat(32),
    originLength: 32,
  };
  const profile = {
    publicKey,
    credentialId: 'AQ',
    credentialIdHash: '0x' + 'ab'.repeat(32),
    passkeyName: 'Retained approval',
  };
  function observed(publicData = publicKey, installed = true) {
    (aggregateContractCalls as jest.Mock).mockResolvedValue([
      { success: true, result: [installed] },
      {
        success: true,
        result: [
          [
            publicData.x,
            publicData.y,
            publicData.rpIdHash,
            publicData.originHash,
            publicData.originLength,
          ],
        ],
      },
      { success: true, result: [true] },
      {
        success: true,
        result: [['0x0000000000000000000000000000000000000001']],
      },
      { success: true, result: [1] },
      { success: true, result: [false] },
      { success: true, result: [[]] },
      { success: true, result: [0] },
      { success: true, result: [false] },
      { success: true, result: [[]] },
      {
        success: true,
        result: [getConfiguredAuthenticatorAddress(1, 'ecdsa')],
      },
    ]);
  }
  it('retains only known public credential fields for an exact installed P256 configuration under another active method', async () => {
    observed();
    const built = buildP256WebAuthnAuthenticator({
      chainId: 1,
      config: profile,
    });
    const result = await readSmartAccountValidatorMetadata({
      account: {
        ...identity.account,
        smartAccount: {
          ...identity.account.smartAccount,
          installedModules: built.metadata.installedModules,
        },
      },
      chainId: 1,
      provider: { getCode: async () => '0x01' } as any,
      assertCurrent() {
        return undefined;
      },
    });
    const installed = result.installedModules!.find(
      (module) => module.id === 'p256-webauthn'
    );
    expect(installed?.config).toMatchObject(profile);
    expect(result.auth?.module).toBe('ecdsa');
  });
  it.each([
    'x',
    'y',
    'rpIdHash',
    'originHash',
    'originLength',
    'absent',
  ] as const)(
    'never carries a local credential across a changed %s observation',
    async (field) => {
      const changed = {
        ...publicKey,
        ...(field === 'absent'
          ? {}
          : {
              [field]: field === 'originLength' ? 33 : '0x' + '99'.repeat(32),
            }),
      };
      observed(changed, field !== 'absent');
      const built = buildP256WebAuthnAuthenticator({
        chainId: 1,
        config: profile,
      });
      const result = await readSmartAccountValidatorMetadata({
        account: {
          ...identity.account,
          smartAccount: {
            ...identity.account.smartAccount,
            installedModules: built.metadata.installedModules,
          },
        },
        chainId: 1,
        provider: { getCode: async () => '0x01' } as any,
        assertCurrent() {
          return undefined;
        },
      });
      const installed = result.installedModules!.find(
        (module) => module.id === 'p256-webauthn'
      );
      expect(installed && 'credentialId' in installed.config).not.toBe(true);
      expect(installed && 'credentialIdHash' in installed.config).not.toBe(
        true
      );
    }
  );
});
