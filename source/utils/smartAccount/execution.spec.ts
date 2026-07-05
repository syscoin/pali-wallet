import { webcrypto } from 'crypto';

import { KeyringAccountType } from 'types/network';
import { SLH_DSA_SIGNATURE_LENGTH } from 'utils/slhDsa/constants';

import { signAndSubmitSmartAccountExecutions } from './execution';

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
