jest.mock('./aggregate', () => ({
  ...jest.requireActual('./aggregate'),
  aggregateContractCalls: jest.fn(),
}));

import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { aggregateContractCalls } from './aggregate';
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
});
