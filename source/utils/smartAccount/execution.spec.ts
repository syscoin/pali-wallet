import { webcrypto } from 'crypto';

import { KeyringAccountType } from 'types/network';
import { SLH_DSA_SIGNATURE_LENGTH } from 'utils/slhDsa/constants';

import {
  getSmartAccountLocalOwnerContexts,
  signAndSubmitSmartAccountExecutions,
  signSmartAccountActionHash,
} from './execution';

const ACCOUNT_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ENTRY_TARGET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const VALIDATOR_ADDRESS = '0xcccccccccccccccccccccccccccccccccccccccc';
const validSlhDsaSignature = `0x${'11'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`;

const smartAccount = {
  auth: {
    data: '0x',
    module: 'slh-dsa',
    validator: VALIDATOR_ADDRESS,
  },
  chainId: 57,
  installedModules: [
    {
      address: VALIDATOR_ADDRESS,
      config: {
        keyId: 'test-key',
        parameterSet: 'SLH-DSA-SHA2-128-24',
        pkRoot: '0x' + '22'.repeat(32),
        pkSeed: '0x' + '33'.repeat(16),
        signatureLimit: 100,
      },
      id: 'slh-dsa',
      type: 'validator',
    },
  ],
  isDeployed: true,
} as any;

describe('signAndSubmitSmartAccountExecutions', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });

  it('does not reuse SLH-DSA submit jobs across different fee overrides', async () => {
    const executions = [{ data: '0x', target: ENTRY_TARGET, value: '0x0' }];
    const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
    const controllerEmitter = jest.fn(
      async ([, method]: string[], payload: any[]) => {
        if (method === 'prepareSmartAccountExecutions') {
          const options = payload[2] || {};
          return {
            actionHash:
              options.feeOverrides?.maxFeePerGas === '2'
                ? '0x' + '02'.repeat(32)
                : '0x' + '01'.repeat(32),
            executionCalldata: '0x',
            executions,
            gasPayer: { id: 0, type: KeyringAccountType.HDAccount },
            maxFeePerGas: options.feeOverrides?.maxFeePerGas,
            maxPriorityFeePerGas: options.feeOverrides?.maxPriorityFeePerGas,
            mode: '0x',
            smartAccount,
            userOperation: {
              callData: '0x',
              initCode: '0x',
              sender: ACCOUNT_ADDRESS,
            },
            validator: VALIDATOR_ADDRESS,
          };
        }

        if (method === 'submitSmartAccountExecution') {
          return payload[0];
        }

        throw new Error(`Unexpected method ${method}`);
      }
    );

    const baseParams = {
      accountAddress: ACCOUNT_ADDRESS,
      accountId: 0,
      authenticatorContexts: {
        'slh-dsa': { signActionHash },
      },
      controllerEmitter,
      executions,
      smartAccount,
    };

    await Promise.all([
      signAndSubmitSmartAccountExecutions({
        ...baseParams,
        feeOverrides: {
          maxFeePerGas: '1',
          maxPriorityFeePerGas: '0',
        },
      }),
      signAndSubmitSmartAccountExecutions({
        ...baseParams,
        feeOverrides: {
          maxFeePerGas: '2',
          maxPriorityFeePerGas: '0',
        },
      }),
    ]);

    const prepareCalls = controllerEmitter.mock.calls.filter(
      ([[, method]]) => method === 'prepareSmartAccountExecutions'
    );
    const submitCalls = controllerEmitter.mock.calls.filter(
      ([[, method]]) => method === 'submitSmartAccountExecution'
    );

    expect(prepareCalls).toHaveLength(2);
    expect(submitCalls).toHaveLength(2);
    expect(signActionHash).toHaveBeenCalledTimes(2);
  });
});

describe('getSmartAccountLocalOwnerContexts', () => {
  it('keeps raw action-digest signing on the internal controller path', async () => {
    const owner = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
      type: KeyringAccountType.HDAccount,
    };
    const actionHash = `0x${'22'.repeat(32)}`;
    const signature = `0x${'33'.repeat(65)}`;
    const controllerEmitter = jest.fn().mockResolvedValue(signature);
    const contexts = getSmartAccountLocalOwnerContexts({
      accounts: {
        [KeyringAccountType.HDAccount]: {
          [owner.id]: { address: owner.address },
        },
      },
      controllerEmitter,
    });
    const ecdsaContext = contexts.ecdsa as {
      signActionHash: (params: {
        actionHash: string;
        owner: typeof owner;
      }) => Promise<string>;
    };

    await expect(
      ecdsaContext.signActionHash({ actionHash, owner })
    ).resolves.toBe(signature);
    expect(controllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'signSmartAccountActionDigestInternal'],
      [[owner.address, actionHash], { id: owner.id, type: owner.type }],
      10000
    );
  });

  it('hands the local ECDSA signer the canonical action hash', async () => {
    const owner = {
      address: '0x1111111111111111111111111111111111111111',
      id: 0,
      type: KeyringAccountType.HDAccount,
    };
    const actionHash = `0x${'44'.repeat(32)}`;
    const signature = `0x${'55'.repeat(65)}`;
    const signActionHash = jest.fn().mockResolvedValue(signature);
    const ecdsaSmartAccount = {
      auth: {
        data: '0x',
        module: 'ecdsa',
        validator: VALIDATOR_ADDRESS,
      },
      chainId: 57,
      installedModules: [
        {
          address: VALIDATOR_ADDRESS,
          config: { owners: [owner.address], threshold: 1 },
          id: 'ecdsa',
          type: 'validator',
        },
      ],
      isDeployed: true,
    } as any;

    await expect(
      signSmartAccountActionHash({
        actionHash,
        authenticatorContexts: {
          ecdsa: { localOwners: [owner], signActionHash },
        },
        smartAccount: ecdsaSmartAccount,
      })
    ).resolves.toMatchObject({ signature });

    expect(signActionHash).toHaveBeenCalledWith({
      actionHash,
      owner,
    });
  });
});
