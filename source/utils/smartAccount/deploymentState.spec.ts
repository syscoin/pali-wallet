import { smartAccountAddressFixture } from 'tests/fixtures/smartAccountAddress';

import { readSmartAccountDeploymentState } from './deploymentState';

it.each([
  ['0x', 'undeployed'],
  ['0x6000', 'deployed'],
])('observes %s only at the verified account', async (code, expected) => {
  const { account } = smartAccountAddressFixture();
  const getCode = jest.fn().mockResolvedValue(code);
  await expect(
    readSmartAccountDeploymentState({
      account,
      chainId: 1,
      provider: { getCode },
      assertCurrent: () => undefined,
    })
  ).resolves.toBe(expected);
  expect(getCode).toHaveBeenCalledTimes(1);
  expect(getCode).toHaveBeenCalledWith(account.address);
});

it.each(['0x0', '0xzz', '', null])(
  'rejects malformed code %s',
  async (code) => {
    const { account } = smartAccountAddressFixture();
    await expect(
      readSmartAccountDeploymentState({
        account,
        chainId: 1,
        provider: { getCode: jest.fn().mockResolvedValue(code) },
        assertCurrent: () => undefined,
      })
    ).rejects.toThrow('Invalid smart account code response');
  }
);

it('rejects a substituted account before asking its provider', async () => {
  const { account } = smartAccountAddressFixture();
  const getCode = jest.fn().mockResolvedValue('0x6000');
  await expect(
    readSmartAccountDeploymentState({
      account: { ...account, address: '0x' + '11'.repeat(20) },
      chainId: 1,
      provider: { getCode },
      assertCurrent: () => undefined,
    })
  ).rejects.toThrow('Smart account address could not be verified');
  expect(getCode).not.toHaveBeenCalled();
});

it('discards a code response after its captured authority ends', async () => {
  const { account } = smartAccountAddressFixture();
  let current = true;
  await expect(
    readSmartAccountDeploymentState({
      account,
      chainId: 1,
      provider: {
        async getCode() {
          current = false;
          return '0x6000';
        },
      },
      assertCurrent() {
        if (!current) throw Error('Retired');
      },
    })
  ).rejects.toThrow('Retired');
});
