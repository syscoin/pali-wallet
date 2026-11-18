import { webcrypto } from 'crypto';
import { recoverAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import {
  SYNTHETIC_ENTRYPOINT_USER_OPERATION,
  withReviewedSmartAccountExecution,
} from 'tests/fixtures/reviewedSmartAccountExecution';

import {
  recordSendCallsBundle,
  reserveSendCallsBundle,
} from '../../scripts/Background/controllers/message-handler/sendCallsBundles';
import { captureSmartAccountCallsIdentity } from '../../shared/dappCallsStatus';
import { KeyringAccountType } from 'types/network';
import { SLH_DSA_SIGNATURE_LENGTH } from 'utils/slhDsa/constants';

import {
  buildSmartAccountUserOperation,
  encodeERC7579Executions,
  encodeSmartAccountGasFees,
  encodeSmartAccountValidatorNonceKey,
} from './account';
import {
  paliEntryPointInterface,
  paliSmartAccountInterface,
} from './contracts';
import { signAndSubmitSmartAccountExecutions } from './execution';
import { getSmartAccountUserOpHash } from './userOperationHash';

const reviewedFixture = (
  params: Parameters<typeof signAndSubmitSmartAccountExecutions>[0]
) =>
  withReviewedSmartAccountExecution(params, {
    payer: { address: '0x' + '44'.repeat(20), id: 0, type: 'HDAccount' },
    userOperation: SYNTHETIC_ENTRYPOINT_USER_OPERATION,
  });

const sender = `0x${'aa'.repeat(20)}`;
const target = `0x${'bb'.repeat(20)}`;
const host = 'https://batch-retry.invalid';
const id = '0x1234';
const descriptor = { atomic: true, chainId: 57, smartAccount: true };
const storageKey = 'pali-sendcalls-bundles';
const metadata = (validator: string) =>
  ({
    auth: { data: '0x', module: 'slh-dsa', validator },
    chainId: 57,
    installedModules: [
      {
        address: validator,
        config: {
          keyId: 'public-test-key',
          parameterSet: 'SLH-DSA-SHA2-128-24',
          pkRoot: `0x${'22'.repeat(32)}`,
          pkSeed: `0x${'33'.repeat(16)}`,
          signatureLimit: 100,
        },
        id: 'slh-dsa',
        type: 'validator',
      },
    ],
    isDeployed: true,
  } as any);

it('retains the first signed batch identity after an outer-payer refusal without silently replacing it', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  let store: Record<string, any> = {};
  const get = jest
    .spyOn(chrome.storage.local, 'get')
    .mockImplementation((_keys, callback: any) => {
      // Chrome storage returns JSON records in the receiving realm.
      callback({ [storageKey]: JSON.parse(JSON.stringify(store)) });
    });
  const set = jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((value: any, callback: any) => {
      store = JSON.parse(JSON.stringify(value[storageKey]));
      callback();
      delete (chrome.runtime as any).lastError;
    });
  const logging = jest.spyOn(console, 'error').mockImplementation();
  try {
    await reserveSendCallsBundle(host, id, descriptor, 'reservation', sender);
    const prepared = new Map<string, any>();
    let preparations = 0;
    let submissions = 0;
    let lastSubmissionId: string | undefined;
    const sign = jest.fn(
      async () => `0x${'11'.repeat(SLH_DSA_SIGNATURE_LENGTH)}`
    );
    const initialMetadata = metadata(`0x${'cc'.repeat(20)}`);
    const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
      if (
        method === 'assertSmartAccountExecutionContext' ||
        method === 'assertSmartAccountPreparedNonce'
      ) {
        expect(prepared.get(payload[0])?.actionHash).toBe(payload[1]);
        return;
      }
      if (method === 'prepareSmartAccountExecutions') {
        const index = ++preparations;
        const userOperation = buildSmartAccountUserOperation({
          sender,
          nonce: '0',
          callData: '0x',
          gasFees: encodeSmartAccountGasFees({
            maxFeePerGas: index,
            maxPriorityFeePerGas: index,
          }),
        });
        const identity = captureSmartAccountCallsIdentity(userOperation, 57);
        const result = {
          accountId: 0,
          executionContextId: `context-${index}`,
          actionHash: identity.userOpHash,
          executions: [],
          userOperation,
          smartAccount:
            index === 1 ? initialMetadata : metadata(`0x${'dd'.repeat(20)}`),
        };
        prepared.set(result.executionContextId, result);
        return result;
      }
      if (method === 'submitSmartAccountExecution') {
        submissions++;
        if (submissions === 1)
          throw Object.assign(new Error('AA24 signature error'), {
            transactionNotBroadcast: true,
          });
        return { hash: `0x${'44'.repeat(32)}` };
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const attempt = signAndSubmitSmartAccountExecutions(
      reviewedFixture({
        accountAddress: sender,
        accountId: 0,
        smartAccount: initialMetadata,
        authenticatorContexts: { 'slh-dsa': { signActionHash: sign } },
        controllerEmitter: emitter,
        executions: [{ target, data: '0x', value: '0x0' }],
        expectedContext: {
          account: {
            id: 0,
            address: sender,
            type: KeyringAccountType.SmartAccount,
          },
          chainId: 57,
          rpcUrl: 'https://rpc.invalid',
          slip44: 60,
        },
        onBeforeSubmit: async ({ executionContextId }) => {
          const operation = prepared.get(executionContextId).userOperation;
          const submissionId = `submission-${preparations}`;
          await recordSendCallsBundle(host, id, {
            ...descriptor,
            reservationId: 'reservation',
            submissionStarted: true,
            previousSubmissionId: lastSubmissionId,
            submissionId,
            txHashes: [],
            smartAccountIdentity: captureSmartAccountCallsIdentity(
              operation,
              57
            ),
          });
          lastSubmissionId = submissionId;
        },
      })
    );
    await expect(attempt).rejects.toThrow('AA24 signature error');
    expect(preparations).toBe(1);
    expect(submissions).toBe(1);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(store[host][id]).toMatchObject({
      submissionStarted: true,
      submissionId: 'submission-1',
      smartAccountIdentity: {
        userOpHash: prepared.get('context-1').actionHash,
      },
    });
    expect(store[host][id].submissionNotBroadcast).not.toBe(true);
  } finally {
    get.mockRestore();
    set.mockRestore();
    logging.mockRestore();
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
  }
});

it.each([
  'AA24 after disclosure',
  'payer fee declined',
  'genuine signer failure',
])(
  'does not create a fresh nonce authorization after %s',
  async (failureStage) => {
    const owner = new Wallet('0x' + '63'.repeat(32));
    const validator = '0x' + '64'.repeat(20);
    const smartAccount: any = {
      chainId: 57,
      isDeployed: true,
      auth: { module: 'ecdsa', validator, data: '0x' },
      installedModules: [
        {
          type: 'validator',
          id: 'ecdsa',
          address: validator,
          config: { owners: [owner.address], threshold: 1 },
        },
      ],
    };
    let canonicalNonce = 0,
      preparations = 0;
    const executions = [{ target, value: '1000000000000000', data: '0x' }];
    const encoded = encodeERC7579Executions(executions);
    const callData = paliSmartAccountInterface.encodeFunctionData('execute', [
      encoded.mode,
      encoded.executionCalldata,
    ]);
    const nonceBase =
      BigInt(encodeSmartAccountValidatorNonceKey(validator)) << BigInt(64);
    const contexts = new Map<string, any>();
    const disclosed: { hash: string; nonce: string; signature: string }[] = [];
    const failure = Object.assign(
      new Error(
        failureStage === 'payer fee declined'
          ? 'Gas fee approval declined'
          : 'AA24 signature error'
      ),
      {
        transactionNotBroadcast: true,
        ...(failureStage === 'payer fee declined' ? { code: 4001 } : {}),
      }
    );
    const estimate = jest.fn(async (data: string) => {
      const [operations] = paliEntryPointInterface.decodeFunctionData(
        'handleOps',
        data
      );
      expect(operations).toHaveLength(1);
      const operation = operations[0];
      const hash = getSmartAccountUserOpHash(operation, 57);
      expect(recoverAddress(hash, operation.signature)).toBe(owner.address);
      disclosed.push({
        nonce: operation.nonce.toString(),
        hash,
        signature: operation.signature,
      });
      // The disclosed authorization could execute independently. Offer the
      // next nonce to any automatic fresh preparation after this RPC error.
      canonicalNonce = 1;
      if (failureStage === 'AA24 after disclosure') throw failure;
      return '0x100000';
    });
    const emitter = jest.fn(async ([, method]: string[], payload: any[]) => {
      if (method === 'assertSmartAccountExecutionContext') return;
      if (method === 'prepareSmartAccountExecutions') {
        const executionContextId = `signed-operation-${++preparations}`;
        const userOperation = buildSmartAccountUserOperation({
          sender,
          nonce: (nonceBase + BigInt(canonicalNonce)).toString(),
          callData,
          gasFees: encodeSmartAccountGasFees({
            maxFeePerGas: 2,
            maxPriorityFeePerGas: 1,
          }),
        });
        const prepared = {
          accountId: 0,
          executionContextId,
          userOperation,
          actionHash: getSmartAccountUserOpHash(userOperation, 57),
          executions: payload[0],
          smartAccount,
        };
        contexts.set(executionContextId, prepared);
        return prepared;
      }
      if (method === 'submitSmartAccountExecution') {
        const request = payload[0],
          prepared = contexts.get(request.executionContextId);
        expect(request.userOperation).toEqual(
          expect.objectContaining(prepared.userOperation)
        );
        await estimate(
          paliEntryPointInterface.encodeFunctionData('handleOps', [
            [{ ...request.userOperation, signature: request.signature }],
            owner.address,
          ])
        );
        if (failureStage === 'payer fee declined') throw failure;
        return { hash: '0x' + '65'.repeat(32) };
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const sign = jest.fn(async ({ actionHash }: { actionHash: string }) => {
      if (failureStage === 'genuine signer failure') throw failure;
      return owner.signingKey.sign(actionHash).serialized;
    });
    await expect(
      signAndSubmitSmartAccountExecutions(
        reviewedFixture({
          accountAddress: sender,
          accountId: 0,
          smartAccount,
          controllerEmitter: emitter,
          executions,
          authenticatorContexts: {
            ecdsa: {
              localOwners: [
                { address: owner.address, id: 0, type: 'HDAccount' },
              ],
              signActionHash: sign,
            },
          },
        })
      )
    ).rejects.toBe(failure);
    expect(preparations).toBe(1);
    expect(sign).toHaveBeenCalledTimes(1);
    if (failureStage === 'genuine signer failure') {
      expect(estimate).not.toHaveBeenCalled();
      expect(disclosed).toEqual([]);
    } else {
      expect(estimate).toHaveBeenCalledTimes(1);
      expect(disclosed).toHaveLength(1);
      expect(disclosed[0].nonce).toBe(nonceBase.toString());
      expect(canonicalNonce).toBe(1);
    }
  }
);
