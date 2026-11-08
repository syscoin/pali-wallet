import { webcrypto } from 'crypto';

import {
  recordSendCallsBundle,
  reserveSendCallsBundle,
} from '../../scripts/Background/controllers/message-handler/sendCallsBundles';
import { captureSmartAccountCallsIdentity } from '../../shared/dappCallsStatus';
import { KeyringAccountType } from 'types/network';
import { SLH_DSA_SIGNATURE_LENGTH } from 'utils/slhDsa/constants';

import {
  buildSmartAccountUserOperation,
  encodeSmartAccountGasFees,
} from './account';
import { signAndSubmitSmartAccountExecutions } from './execution';

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

it.each([false, true])(
  'settles a proven-unsent attempt before refreshing validator/fees (storage failure=%s)',
  async (failRetirement) => {
    const originalCrypto = Object.getOwnPropertyDescriptor(
      globalThis,
      'crypto'
    );
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    let store: Record<string, any> = {};
    let rejectWrite = false;
    const get = jest
      .spyOn(chrome.storage.local, 'get')
      .mockImplementation((_keys, callback: any) => {
        callback({ [storageKey]: structuredClone(store) });
      });
    const set = jest
      .spyOn(chrome.storage.local, 'set')
      .mockImplementation((value: any, callback: any) => {
        if (!rejectWrite) store = structuredClone(value[storageKey]);
        (chrome.runtime as any).lastError = rejectWrite
          ? { message: 'Synthetic write failure' }
          : undefined;
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
        if (method === 'assertSmartAccountExecutionContext') {
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
      const attempt = signAndSubmitSmartAccountExecutions({
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
        onSubmissionNotBroadcast: async () => {
          rejectWrite = failRetirement;
          await recordSendCallsBundle(host, id, {
            ...descriptor,
            reservationId: 'reservation',
            submissionId: lastSubmissionId,
            submissionNotBroadcast: true,
            txHashes: [],
          });
        },
      });
      if (failRetirement) {
        await expect(attempt).rejects.toThrow('Unable to persist');
        expect(preparations).toBe(1);
        expect(submissions).toBe(1);
        expect(sign).toHaveBeenCalledTimes(1);
        expect(store[host][id]).toMatchObject({
          submissionStarted: true,
          submissionId: 'submission-1',
        });
      } else {
        await expect(attempt).resolves.toEqual({
          hash: `0x${'44'.repeat(32)}`,
        });
        expect(preparations).toBe(2);
        expect(submissions).toBe(2);
        expect(sign).toHaveBeenCalledTimes(2);
        expect(prepared.get('context-1').actionHash).not.toBe(
          prepared.get('context-2').actionHash
        );
        expect(store[host][id].smartAccountIdentity.userOpHash).toBe(
          prepared.get('context-2').actionHash
        );
        expect(
          emitter.mock.calls.filter(
            ([[, method]]) => method === 'prepareSmartAccountExecutions'
          )[1][1][2].useCachedMetadata
        ).toBe(false);
      }
    } finally {
      get.mockRestore();
      set.mockRestore();
      logging.mockRestore();
      if (originalCrypto)
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  }
);
