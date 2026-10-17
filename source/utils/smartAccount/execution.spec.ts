import { createHash, webcrypto } from 'crypto';

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

  const expectedContext = {
    account: {
      address: ACCOUNT_ADDRESS,
      id: 0,
      type: KeyringAccountType.SmartAccount,
    },
    chainId: 57,
    rpcUrl: 'rpc-a',
    sessionGeneration: 7,
    slip44: 57,
  };

  it.each([
    ['5000', false],
    ['5001', true],
  ])(
    'enforces the approved EntryPoint account-charge ceiling before signing (%s)',
    async (approved, allowed) => {
      const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
      const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
        if (method === 'prepareSmartAccountExecutions')
          return {
            actionHash: `0x${'12'.repeat(32)}`,
            executionContextId: 'fee-context',
            executions: [],
            smartAccount,
            userOperation: {
              sender: ACCOUNT_ADDRESS,
              accountGasLimits:
                '0x' +
                BigInt(1000).toString(16).padStart(32, '0') +
                BigInt(500).toString(16).padStart(32, '0'),
              preVerificationGas: '167',
              gasFees:
                '0x' +
                '0'.repeat(32) +
                BigInt(3).toString(16).padStart(32, '0'),
            },
          };
        if (method === 'assertSmartAccountExecutionContext') return;
        if (method === 'submitSmartAccountExecution') return payload[0];
        throw Error(method);
      });
      const request = signAndSubmitSmartAccountExecutions({
        accountId: 0,
        accountAddress: ACCOUNT_ADDRESS,
        smartAccount,
        authenticatorContexts: { 'slh-dsa': { signActionHash } },
        controllerEmitter: emitter,
        executions: [],
        expectedContext,
        maximumUserOpFeeWei: approved,
      });
      if (allowed) await expect(request).resolves.toBeTruthy();
      else
        await expect(request).rejects.toMatchObject({
          message: 'PALI_SMART_ACCOUNT_FEE_QUOTE_CHANGED',
          transactionNotBroadcast: true,
        });
      expect(signActionHash).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(
        emitter.mock.calls.filter(
          ([[, method]]) => method === 'submitSmartAccountExecution'
        )
      ).toHaveLength(allowed ? 1 : 0);
    }
  );

  it.each(['before signing', 'after signing', 'after durable marker'])(
    'rejects a stale approval %s before submission',
    async (stage) => {
      const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
      const beforeSubmit = jest.fn();
      let checks = 0;
      const expectedCheck =
        stage === 'before signing' ? 1 : stage === 'after signing' ? 2 : 3;
      const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
        if (method === 'prepareSmartAccountExecutions') {
          expect(payload[2].expectedContext).toEqual(expectedContext);
          return {
            actionHash: `0x${'12'.repeat(32)}`,
            executionContextId: 'prepared-context',
            executions: [],
            smartAccount,
            userOperation: { sender: ACCOUNT_ADDRESS },
          };
        }
        if (method === 'assertSmartAccountExecutionContext') {
          expect(payload).toEqual(['prepared-context', `0x${'12'.repeat(32)}`]);
          if (++checks === expectedCheck)
            throw Object.assign(Error('PALI_TRANSACTION_CONTEXT_CHANGED'), {
              transactionNotBroadcast: true,
            });
          return;
        }
        throw Error(`Unexpected method ${method}`);
      });
      await expect(
        signAndSubmitSmartAccountExecutions({
          accountAddress: ACCOUNT_ADDRESS,
          accountId: 0,
          authenticatorContexts: { 'slh-dsa': { signActionHash } },
          controllerEmitter: emitter,
          executions: [],
          expectedContext,
          onBeforeSubmit: beforeSubmit,
          smartAccount,
        })
      ).rejects.toMatchObject({ transactionNotBroadcast: true });
      expect(signActionHash).toHaveBeenCalledTimes(expectedCheck === 1 ? 0 : 1);
      if (expectedCheck > 1)
        expect(signActionHash).toHaveBeenCalledWith(
          expect.objectContaining({ executionContextId: 'prepared-context' })
        );
      expect(beforeSubmit).toHaveBeenCalledTimes(expectedCheck === 3 ? 1 : 0);
      expect(
        emitter.mock.calls.some(
          ([[, method]]) => method === 'submitSmartAccountExecution'
        )
      ).toBe(false);
    }
  );

  it('does not sign an approval whose preparation omitted its background context', async () => {
    const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
    await expect(
      signAndSubmitSmartAccountExecutions({
        accountAddress: ACCOUNT_ADDRESS,
        accountId: 0,
        authenticatorContexts: { 'slh-dsa': { signActionHash } },
        controllerEmitter: jest.fn().mockResolvedValue({ actionHash: '0x' }),
        executions: [],
        expectedContext,
        smartAccount,
      })
    ).rejects.toMatchObject({ transactionNotBroadcast: true });
    expect(signActionHash).not.toHaveBeenCalled();
  });

  it('keeps concurrent external SLH approvals on separate context and submission paths', async () => {
    const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
    let preparations = 0;
    const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
      if (method === 'prepareSmartAccountExecutions')
        return {
          actionHash: `0x${'12'.repeat(32)}`,
          executionContextId: `prepared-${++preparations}`,
          executions: [],
          smartAccount,
          userOperation: { sender: ACCOUNT_ADDRESS },
        };
      if (method === 'assertSmartAccountExecutionContext') return;
      if (method === 'submitSmartAccountExecution') return payload[0];
      throw Error(`Unexpected method ${method}`);
    });
    const firstMarker = jest.fn();
    const secondMarker = jest.fn();
    const params = {
      accountAddress: ACCOUNT_ADDRESS,
      accountId: 0,
      authenticatorContexts: { 'slh-dsa': { signActionHash } },
      controllerEmitter: emitter,
      executions: [],
      expectedContext,
      smartAccount,
    };
    const results = await Promise.all([
      signAndSubmitSmartAccountExecutions({
        ...params,
        onBeforeSubmit: firstMarker,
      }),
      signAndSubmitSmartAccountExecutions({
        ...params,
        onBeforeSubmit: secondMarker,
      }),
    ]);
    expect(preparations).toBe(2);
    expect(firstMarker).toHaveBeenCalledTimes(1);
    expect(secondMarker).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.executionContextId)).toEqual([
      'prepared-1',
      'prepared-2',
    ]);
    expect(
      results.every((result) => result.expectedContext === expectedContext)
    ).toBe(true);
  });

  it('keeps context-bound internal policy submissions single-flight', async () => {
    // Real SHA-256 with immediately settled I/O makes admission ordering
    // deterministic; this test does not exercise WebCrypto scheduling.
    const digest = jest.spyOn(crypto.subtle, 'digest').mockImplementation(
      async (_algorithm, data) =>
        Uint8Array.from(
          createHash('sha256')
            .update(Buffer.from(data as ArrayBuffer))
            .digest()
        ).buffer
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const signActionHash = jest.fn(async () => {
      await gate;
      return validSlhDsaSignature;
    });
    const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
      if (method === 'prepareSmartAccountExecutions')
        return {
          actionHash: `0x${'12'.repeat(32)}`,
          executionContextId: 'policy-context',
          executions: [],
          smartAccount,
        };
      if (method === 'assertSmartAccountExecutionContext') return;
      if (method === 'submitSmartAccountExecution') return payload[0];
      throw Error(method);
    });
    const params = {
      accountId: 0,
      accountAddress: ACCOUNT_ADDRESS,
      smartAccount,
      executions: [],
      expectedContext,
      trackLocalSubmission: true,
      controllerEmitter: emitter,
      authenticatorContexts: { 'slh-dsa': { signActionHash } },
    };
    try {
      const requests = [
        signAndSubmitSmartAccountExecutions(params),
        signAndSubmitSmartAccountExecutions(params),
      ];
      // Hold the signature until both immediately settled admission paths ran.
      await new Promise<void>((resolve) => setImmediate(resolve));
      release();
      await Promise.all(requests);
      expect(signActionHash).toHaveBeenCalledTimes(1);
      expect(
        emitter.mock.calls.filter(
          ([[, method]]) => method === 'submitSmartAccountExecution'
        )
      ).toHaveLength(1);
    } finally {
      release();
      digest.mockRestore();
    }
  });

  it.each(['session', 'RPC'])(
    'never shares a local policy result across %s contexts',
    async (axis) => {
      const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
      const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
        if (method === 'prepareSmartAccountExecutions')
          return {
            actionHash: `0x${'12'.repeat(32)}`,
            executionContextId: 'policy-context',
            executions: [],
            smartAccount,
          };
        if (method === 'assertSmartAccountExecutionContext') return;
        if (method === 'submitSmartAccountExecution') return payload[0];
        throw Error(method);
      });
      const params = {
        accountId: 0,
        accountAddress: ACCOUNT_ADDRESS,
        smartAccount,
        executions: [],
        trackLocalSubmission: true,
        controllerEmitter: emitter,
        authenticatorContexts: { 'slh-dsa': { signActionHash } },
      };
      const other = {
        ...expectedContext,
        ...(axis === 'session'
          ? { sessionGeneration: 8 }
          : { rpcUrl: 'rpc-b' }),
      };
      const results = await Promise.all([
        signAndSubmitSmartAccountExecutions({ ...params, expectedContext }),
        signAndSubmitSmartAccountExecutions({
          ...params,
          expectedContext: other,
        }),
      ]);
      expect(signActionHash).toHaveBeenCalledTimes(2);
      expect(results.map((result) => result.expectedContext)).toEqual([
        expectedContext,
        other,
      ]);
    }
  );

  it.each(['maxFeePerGas', 'gasPrice'])(
    'does not reuse SLH-DSA submit jobs across different %s overrides',
    async (feeField) => {
      const executions = [{ data: '0x', target: ENTRY_TARGET, value: '0x0' }];
      const signActionHash = jest.fn().mockResolvedValue(validSlhDsaSignature);
      const controllerEmitter = jest.fn(
        async ([, method]: string[], payload: any[]) => {
          if (method === 'prepareSmartAccountExecutions') {
            const options = payload[2] || {};
            return {
              actionHash:
                options.feeOverrides?.[feeField] === '2'
                  ? '0x' + '02'.repeat(32)
                  : '0x' + '01'.repeat(32),
              executionCalldata: '0x',
              executions,
              gasPayer: { id: 0, type: KeyringAccountType.HDAccount },
              gasPrice: options.feeOverrides?.gasPrice,
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
            [feeField]: '1',
            ...(feeField === 'maxFeePerGas'
              ? { maxPriorityFeePerGas: '0' }
              : {}),
          },
        }),
        signAndSubmitSmartAccountExecutions({
          ...baseParams,
          feeOverrides: {
            [feeField]: '2',
            ...(feeField === 'maxFeePerGas'
              ? { maxPriorityFeePerGas: '0' }
              : {}),
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
      if (feeField === 'gasPrice') {
        expect(submitCalls.map((call) => call[1][0].gasPrice).sort()).toEqual([
          '1',
          '2',
        ]);
      }
      expect(signActionHash).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    { marker: undefined, acknowledged: false, expected: 1 },
    { marker: false, acknowledged: false, expected: 1 },
    { marker: true, acknowledged: false, expected: 2 },
    { marker: true, acknowledged: true, expected: 1 },
  ])(
    'retries a submitted signature error only when proven unsent: %j',
    async ({ marker, acknowledged, expected }) => {
      const executions = [{ data: '0x', target: ENTRY_TARGET, value: '0x0' }];
      const events: string[] = [];
      let submits = 0;
      const error = Object.assign(Error('AA24 signature error'), {
        transactionNotBroadcast: marker,
        transactionHash: acknowledged ? `0x${'12'.repeat(32)}` : undefined,
      });
      const emitter = jest.fn(async ([, method]: string[]) => {
        if (method === 'prepareSmartAccountExecutions')
          return {
            actionHash: `0x${'01'.repeat(32)}`,
            executions,
            smartAccount,
            userOperation: {},
          };
        events.push('submit');
        submits += 1;
        if (submits === 1) throw error;
        return { hash: 'retried' };
      });
      const submitting = signAndSubmitSmartAccountExecutions({
        accountAddress: ACCOUNT_ADDRESS,
        accountId: 0,
        smartAccount,
        authenticatorContexts: {
          'slh-dsa': { signActionHash: async () => validSlhDsaSignature },
        },
        controllerEmitter: emitter,
        executions,
        onBeforeSubmit: async () => {
          events.push('durable begin');
        },
      });
      if (expected === 2)
        await expect(submitting).resolves.toEqual({ hash: 'retried' });
      else await expect(submitting).rejects.toBe(error);
      const calls = emitter.mock.calls.filter(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      );
      expect(calls).toHaveLength(expected);
      for (const call of calls) expect(call.slice(2)).toEqual([300000, false]);
      expect(events).toEqual(
        Array.from({ length: expected }, () => [
          'durable begin',
          'submit',
        ]).flat()
      );
    }
  );

  it('does not invoke smart submission if its durable boundary fails', async () => {
    const emitter = jest.fn().mockResolvedValue({
      actionHash: `0x${'01'.repeat(32)}`,
      executions: [],
      smartAccount,
    });
    await expect(
      signAndSubmitSmartAccountExecutions({
        accountAddress: ACCOUNT_ADDRESS,
        accountId: 0,
        smartAccount,
        authenticatorContexts: {
          'slh-dsa': { signActionHash: async () => validSlhDsaSignature },
        },
        controllerEmitter: emitter,
        executions: [],
        onBeforeSubmit: async () => {
          throw Error('Persistence failed');
        },
      })
    ).rejects.toThrow('Persistence failed');
    expect(emitter.mock.calls.map(([[, method]]) => method)).toEqual([
      'prepareSmartAccountExecutions',
    ]);
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
