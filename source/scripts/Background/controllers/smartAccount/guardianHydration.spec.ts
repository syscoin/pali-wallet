jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: { activeNetwork: { chainId: 999 } } }),
  },
}));

jest.mock('state/vault', () => ({}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/smartAccount/aggregate', () => ({
  ...jest.requireActual('utils/smartAccount/aggregate'),
  aggregateContractCalls: jest.fn(),
}));

import { AddressZero, getAddress } from 'utils/ethersV6Compat';
import { aggregateContractCalls } from 'utils/smartAccount/aggregate';
import { PALI_MODULE_CANONICAL_ADDRESSES } from 'utils/smartAccount/deployment';

import SmartAccountController from './index';

const accountAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const customAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const guardianAddress = '0xcccccccccccccccccccccccccccccccccccccccc';
const moduleAddress = PALI_MODULE_CANONICAL_ADDRESSES['guardian-recovery']!;

describe('guardian policy metadata hydration', () => {
  let controller: any;
  let account: any;

  beforeEach(() => {
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({
        web3Provider: { getCode: jest.fn().mockResolvedValue('0x01') },
      }),
    } as any);
    controller.getGuardianRecoveryStatusForAccount = jest.fn();
    account = {
      address: accountAddress,
      smartAccount: {
        chainId: 57057,
        deploymentSalt: 'saved-deployment-salt',
        customModules: [
          {
            address: customAddress,
            initData: '0x1234',
            moduleType: 1,
            name: 'Custom validator',
          },
        ],
      },
    };
    (aggregateContractCalls as jest.Mock).mockImplementation(
      async (_provider, _chainId, calls) =>
        calls.map((call: any) => ({
          result:
            call.fn === 'activeValidator'
              ? [AddressZero]
              : call.fn === 'isModuleInstalled'
              ? [call.args[1] === customAddress]
              : [],
          success: true,
        }))
    );
  });

  it('reads the installed guardian policy on the account chain and preserves custom modules', async () => {
    controller.getGuardianRecoveryStatusForAccount.mockResolvedValue({
      delaySeconds: 86400,
      expirationSeconds: 604800,
      guardians: [guardianAddress],
      moduleAddress,
      threshold: 1,
    });
    const result = await controller.fetchSmartAccountMetadata(account);

    expect(controller.getGuardianRecoveryStatusForAccount).toHaveBeenCalledWith(
      accountAddress,
      57057
    );
    expect(result.deploymentSalt).toBe('saved-deployment-salt');
    expect(result.installedModules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: getAddress(customAddress),
          id: 'custom',
        }),
        expect.objectContaining({
          address: getAddress(moduleAddress),
          config: expect.objectContaining({
            guardians: [guardianAddress],
            threshold: 1,
          }),
          id: 'guardian-recovery',
        }),
      ])
    );
  });

  it('does not invent a guardian policy when the executor is not installed', async () => {
    controller.getGuardianRecoveryStatusForAccount.mockResolvedValue(null);
    const result = await controller.fetchSmartAccountMetadata(account);
    expect(
      result.installedModules.some(
        (module: any) => module.id === 'guardian-recovery'
      )
    ).toBe(false);
  });

  it('propagates a failed installed-policy read instead of hiding recovery state', async () => {
    controller.getGuardianRecoveryStatusForAccount.mockRejectedValue(
      new Error('policy unavailable')
    );
    await expect(controller.fetchSmartAccountMetadata(account)).rejects.toThrow(
      'policy unavailable'
    );
  });
});
