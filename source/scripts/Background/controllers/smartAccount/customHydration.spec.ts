jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: { activeNetwork: { chainId: 57057 } } }),
  },
}));
jest.mock('state/vault', () => ({}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/smartAccount/aggregate', () => ({
  ...jest.requireActual('utils/smartAccount/aggregate'),
  aggregateContractCalls: jest.fn(),
}));

import { getAddress } from 'utils/ethersV6Compat';
import { getConfiguredAuthenticatorAddress } from 'utils/smartAccount';
import { aggregateContractCalls } from 'utils/smartAccount/aggregate';
import {
  assertValidatorActivationAllowed,
  isPaliSignableValidator,
  listCompositeChildCandidates,
} from 'utils/smartAccount/custom';

import SmartAccountController from './index';

const ACCOUNT = '0x' + '11'.repeat(20);
const OWNER = '0x' + '22'.repeat(20);
const CUSTOM = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const ECDSA = getAddress(getConfiguredAuthenticatorAddress(57057, 'ecdsa'));
const SLH = getAddress(getConfiguredAuthenticatorAddress(57057, 'slh-dsa'));
const COMPOSITE = getAddress(
  getConfiguredAuthenticatorAddress(57057, 'composite')
);
const upper = (address: string) => '0x' + address.slice(2).toUpperCase();

describe('custom validator hydration address identity', () => {
  let controller: any;
  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SmartAccountController({
      getEthereumTransaction: () => ({
        web3Provider: { getCode: jest.fn().mockResolvedValue('0x01') },
      }),
    } as any);
    controller.getGuardianRecoveryStatusForAccount = jest
      .fn()
      .mockResolvedValue(null);
    (aggregateContractCalls as jest.Mock).mockImplementation(
      async (_provider, _chainId, calls) =>
        calls.map((call: any) => ({
          success: true,
          result:
            call.fn === 'isModuleInstalled'
              ? [
                  [ECDSA, SLH, getAddress(CUSTOM)].includes(
                    getAddress(call.args[1])
                  ),
                ]
              : call.fn === 'owners'
              ? [[OWNER]]
              : call.fn === 'threshold'
              ? [1]
              : call.fn === 'authData' && getAddress(call.target) === SLH
              ? [
                  {
                    pkSeed: '0x' + '12'.repeat(16) + '00'.repeat(16),
                    pkRoot: '0x' + '34'.repeat(16) + '00'.repeat(16),
                  },
                ]
              : call.fn === 'activeValidator'
              ? [SLH]
              : [],
        }))
    );
  });

  it('prefers the on-chain builtin once and retains case-variant durable custom records without mutation', async () => {
    const customModules = [
      {
        address: ECDSA.toLowerCase(),
        initData: '0x1234',
        moduleType: 1,
        compositeCompatible: true,
        name: 'ECDSA via custom install',
      },
      {
        address: upper(ECDSA),
        initData: '0x5678',
        moduleType: 1,
        compositeCompatible: true,
        name: 'Repeated case alias',
      },
      {
        address: CUSTOM,
        initData: '0x90ab',
        moduleType: 1,
        compositeCompatible: true,
        name: 'Real custom module',
      },
    ];
    const account = {
      address: ACCOUNT,
      smartAccount: { chainId: 57057, customModules },
    };
    const original = JSON.stringify(account);
    const result = await controller.fetchSmartAccountMetadata(account);
    const addresses = result.installedModules.map((module: any) =>
      module.address.toLowerCase()
    );
    expect(addresses).toHaveLength(3);
    expect(new Set(addresses).size).toBe(3);
    expect(
      result.installedModules.find((module: any) => module.address === ECDSA)
    ).toMatchObject({
      id: 'ecdsa',
      config: { owners: [OWNER], threshold: 1 },
    });
    expect(
      result.installedModules.find(
        (module: any) => module.address === getAddress(CUSTOM)
      )
    ).toMatchObject({ id: 'custom', data: '0x90ab' });
    expect(result.auth.module).toBe('slh-dsa');
    expect(result.customModules).toBe(customModules);
    expect(JSON.stringify(account)).toBe(original);
    expect(listCompositeChildCandidates(result)).toHaveLength(3);
    expect(() => assertValidatorActivationAllowed(result, ECDSA)).not.toThrow();
    expect(
      isPaliSignableValidator(
        {
          address: COMPOSITE,
          type: 'validator',
          id: 'composite',
          config: { childValidators: [ECDSA, SLH], threshold: 2 },
        },
        result
      )
    ).toBe(true);
  });

  it('deduplicates custom address aliases while retaining the actual installed custom validator and durable probes', async () => {
    const customModules = [
      {
        address: CUSTOM,
        initData: '0x1234',
        moduleType: 1,
        compositeCompatible: true,
      },
      {
        address: upper(CUSTOM),
        initData: '0x5678',
        moduleType: 1,
        compositeCompatible: true,
      },
    ];
    const result = await controller.fetchSmartAccountMetadata({
      address: ACCOUNT,
      smartAccount: { chainId: 57057, customModules },
    });
    const customs = result.installedModules.filter(
      (module: any) => module.id === 'custom'
    );
    expect(customs).toHaveLength(1);
    expect(customs[0]).toMatchObject({
      address: getAddress(CUSTOM),
      data: '0x1234',
    });
    expect(result.customModules).toBe(customModules);
    expect(isPaliSignableValidator(customs[0], result)).toBe(false);
  });
});
