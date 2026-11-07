import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import {
  captureEvmSubmission,
  evmSubmissionFailure,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { Wallet, Transaction, Interface } from 'ethers';
import { createHash, webcrypto } from 'node:crypto';

import {
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
  type EvmSignedRecordStorage,
  type EvmSignedRecordSession,
} from '../../../wallet/evmSignedRecords';

import { watchWalletTokenReview } from './approvalSubmission';
import {
  controllerErrorResponse,
  handleMasterControllerResponses,
} from './handleMasterControllerResponses';

jest.setTimeout(180000);
const wallet = new Wallet(`0x${'11'.repeat(32)}`);
function fixture() {
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () =>
    'synthetic extension signed-record fixture';
  const session: EvmSignedRecordSession = { keyring, assertCurrent: () => {} };
  let stored: string | undefined,
    writes = 0;
  const storage: EvmSignedRecordStorage = {
    async read() {
      return stored;
    },
    async compareAndSet(_id, expected, next, check) {
      check();
      if (stored !== expected) return false;
      stored = next;
      writes++;
      return true;
    },
  };
  return {
    session,
    store: new EvmSignedRecords(storage),
    get: () => stored,
    set: (value: string | undefined) => {
      stored = value;
    },
    writes: () => writes,
  };
}
async function signed(nonce: number) {
  const rawTransaction = await wallet.signTransaction({
    type: 2,
    chainId: 7654321,
    nonce,
    to: wallet.address,
    value: 123,
    gasLimit: 42000,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
  const tx = Transaction.from(rawTransaction);
  return {
    rawTransaction,
    hash: tx.hash!,
    from: wallet.address,
    chainId: '7654321',
    nonce,
    type: 2,
    context: {
      account: { type: 'HDAccount', id: 0, address: wallet.address },
      network: {
        kind: 'ethereum',
        chainId: 7654321,
        slip44: 60,
        url: 'https://offline.invalid',
      },
      operation: 'send' as const,
    },
  };
}
const digest = (value: string | undefined) =>
  value === undefined
    ? 'missing'
    : createHash('sha256').update(value).digest('hex');
async function fill(f: ReturnType<typeof fixture>) {
  const first = await signed(0),
    second = await signed(1),
    limit = 16 * 1024 * 1024;
  const maximum = Object.fromEntries(
    Array.from({ length: 1023 }, (_, i) => [
      `k${String(i).padStart(4, '0')}`,
      'x'.repeat(8192),
    ])
  );
  const metadataBytes = (target: number) => {
    const data = Object.fromEntries(Object.keys(maximum).map((k) => [k, '']));
    let remaining = target - Buffer.byteLength(JSON.stringify(data));
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(1023 * 8192);
    for (const key of Object.keys(data)) {
      const n = Math.min(remaining, 8192);
      data[key] = 'x'.repeat(n);
      remaining -= n;
    }
    expect(remaining).toBe(0);
    return data;
  };
  await f.store.append(f.session, first, maximum);
  const probe = fixture();
  probe.set(f.get());
  await probe.store.append(probe.session, second, {});
  const target = 2 + limit - Buffer.byteLength(probe.get()!);
  await f.store.append(f.session, second, metadataBytes(target - 64));
  expect(Buffer.byteLength(f.get()!)).toBe(limit - 64);
  return { first, second };
}
const sender = {
  id: 'pali-extension',
  url: 'chrome-extension://pali-extension/app.html',
};
async function invoke(send: () => Promise<unknown>) {
  Object.assign(chrome.runtime, {
    id: 'pali-extension',
    getURL: (p = '') => `chrome-extension://pali-extension/${p}`,
  });
  handleMasterControllerResponses({
    wallet: { sendAndSaveEthTransaction: send },
  } as any);
  const add = chrome.runtime.onMessage.addListener as jest.Mock;
  const listener = add.mock.calls[add.mock.calls.length - 1][0];
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error('IPC callback timed out')),
      5000
    );
    const accepted = listener(
      {
        type: 'CONTROLLER_ACTION',
        data: {
          methods: ['wallet', 'sendAndSaveEthTransaction'],
          params: [{ nonce: 2 }],
        },
      },
      sender,
      (result: any) => {
        clearTimeout(timer);
        resolve(result);
      }
    );
    if (accepted !== true) {
      clearTimeout(timer);
      reject(Error('IPC action not admitted'));
    }
  });
}

test('real capacity failure crosses trusted extension IPC; forged and reused errors do not claim no broadcast', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  const logging = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    const full = fixture(),
      { first, second } = await fill(full),
      candidate = await signed(2),
      before = digest(full.get()),
      writes = full.writes();
    let callback = 0,
      captured: unknown;
    const boundary = captureEvmSubmission(
      candidate.context,
      full.session.assertCurrent,
      () =>
        createEvmSignedRecordLifecycle(full.store, full.session, {
          retirementReadForChain: null,
        })
    );
    const unsigned = Transaction.from(
      candidate.rawTransaction
    ).unsignedSerialized;
    const fullResponse = await invoke(async () => {
      try {
        return await submitSignedEvmTransaction(
          candidate.rawTransaction,
          ({ admit }) => {
            callback++;
            return admit(async () => candidate.hash);
          },
          boundary,
          undefined,
          unsigned
        );
      } catch (e) {
        captured = e;
        throw e;
      }
    });
    expect(callback).toBe(0);
    expect(full.writes()).toBe(writes);
    expect(digest(full.get())).toBe(before);
    expect(
      (
        await full.store.readExact(
          full.session,
          first.chainId,
          first.from,
          first.hash
        )
      )?.rawTransaction === first.rawTransaction
    ).toBe(true);
    expect(
      (
        await full.store.readExact(
          full.session,
          second.chainId,
          second.from,
          second.hash
        )
      )?.rawTransaction === second.rawTransaction
    ).toBe(true);
    expect(fullResponse).toEqual({
      success: false,
      error: {
        message: 'EVM_SIGNED_STORAGE_FULL',
        code: 'EVM_SIGNED_STORAGE_FULL',
        transactionNotBroadcast: true,
      },
    });
    expect(captured).toBeInstanceOf(Error);
    expect(evmSubmissionFailure(captured)).toEqual({
      transactionNotBroadcast: true,
      signedTransactionHash: candidate.hash,
    });
    const mint = async () => {
      const b = captureEvmSubmission(
        candidate.context,
        full.session.assertCurrent,
        () =>
          createEvmSignedRecordLifecycle(full.store, full.session, {
            retirementReadForChain: null,
          })
      );
      try {
        await submitSignedEvmTransaction(
          candidate.rawTransaction,
          ({ admit }) => admit(async () => candidate.hash),
          b,
          undefined,
          unsigned
        );
        throw Error('Expected capacity refusal');
      } catch (error) {
        expect((error as Error).message).toBe('EVM_SIGNED_RECORD_CAPACITY');
        expect(evmSubmissionFailure(error)).toEqual({
          transactionNotBroadcast: true,
          signedTransactionHash: candidate.hash,
        });
        return error;
      }
    };
    const batchError = await mint();
    expect(
      controllerErrorResponse(batchError, { hash: `0x${'ab'.repeat(32)}` })
        .error
    ).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
    expect(controllerErrorResponse(batchError).error).toHaveProperty(
      'code',
      'EVM_SIGNED_STORAGE_FULL'
    );
    const clean = fixture(),
      ok = captureEvmSubmission(
        candidate.context,
        clean.session.assertCurrent,
        () =>
          createEvmSignedRecordLifecycle(clean.store, clean.session, {
            retirementReadForChain: null,
          })
      );
    let posted = 0;
    const ack = await invoke(async () =>
      submitSignedEvmTransaction(
        candidate.rawTransaction,
        ({ admit }) =>
          admit(async () => {
            posted++;
            return candidate.hash;
          }),
        ok,
        undefined,
        unsigned
      )
    );
    expect(ack).toBe(candidate.hash);
    expect(posted).toBe(1);
    expect(
      (
        await clean.store.readExact(
          clean.session,
          candidate.chainId,
          candidate.from,
          candidate.hash
        )
      )?.rawTransaction === candidate.rawTransaction
    ).toBe(true);
    const reusedError = await mint();
    const reused = fixture(),
      reuseBoundary = captureEvmSubmission(
        candidate.context,
        reused.session.assertCurrent,
        () =>
          createEvmSignedRecordLifecycle(reused.store, reused.session, {
            retirementReadForChain: null,
          })
      );
    let reusedPost = 0;
    const uncertain = await invoke(async () =>
      submitSignedEvmTransaction(
        candidate.rawTransaction,
        ({ admit }) =>
          admit(async () => {
            reusedPost++;
            throw reusedError;
          }),
        reuseBoundary,
        undefined,
        unsigned
      )
    );
    expect(reusedPost).toBe(1);
    expect(evmSubmissionFailure(reusedError).transactionNotBroadcast).toBe(
      false
    );
    expect(uncertain.error).not.toHaveProperty(
      'code',
      'EVM_SIGNED_STORAGE_FULL'
    );
    expect(uncertain.error).not.toHaveProperty('transactionNotBroadcast', true);
    // Deliberate same-object reuse before admit: the current invocation did save
    // the same bytes, so an old capacity marker must not describe it.
    // This is an in-process robustness control, not a demonstrated provider path.
    const staleError = await mint();
    const beforeAdmit = fixture(),
      beforeBoundary = captureEvmSubmission(
        candidate.context,
        beforeAdmit.session.assertCurrent,
        () =>
          createEvmSignedRecordLifecycle(
            beforeAdmit.store,
            beforeAdmit.session,
            { retirementReadForChain: null }
          )
      );
    let beforeAdmitCalls = 0;
    const stale = await invoke(async () =>
      submitSignedEvmTransaction(
        candidate.rawTransaction,
        () => {
          beforeAdmitCalls++;
          throw staleError;
        },
        beforeBoundary,
        undefined,
        unsigned
      )
    );
    expect(beforeAdmitCalls).toBe(1);
    expect(
      (
        await beforeAdmit.store.readExact(
          beforeAdmit.session,
          candidate.chainId,
          candidate.from,
          candidate.hash
        )
      )?.rawTransaction === candidate.rawTransaction
    ).toBe(true);
    expect(stale.error).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
    const forged = await invoke(async () => {
      throw {
        error: true,
        code: 'EVM_SIGNED_STORAGE_FULL',
        transactionNotBroadcast: true,
      };
    });
    expect(forged).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
    expect(forged.error).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
    const forgedSync = {
      error: true,
      code: 'EVM_SIGNED_STORAGE_FULL',
      transactionNotBroadcast: true,
    };
    handleMasterControllerResponses({
      wallet: {
        getWalletSetupStatus: () => {
          throw forgedSync;
        },
        sendAndSaveEthTransaction: async () => undefined,
      },
    } as any);
    const add = chrome.runtime.onMessage.addListener as jest.Mock;
    const listener = add.mock.calls[add.mock.calls.length - 1][0];
    const respond = jest.fn();
    expect(
      listener(
        {
          type: 'CONTROLLER_ACTION',
          data: {
            methods: ['wallet', 'sendAndSaveEthTransaction'],
            params: [{ nonce: 2 }],
          },
        },
        sender,
        respond
      )
    ).toBe(false);
    expect(respond).toHaveBeenCalledTimes(1);
    const result = respond.mock.calls[0][0];
    expect(result).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
    expect(result.error).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
  } finally {
    logging.mockRestore();
    if (prior) Object.defineProperty(globalThis, 'crypto', prior);
    else delete (globalThis as any).crypto;
  }
});

// Private test-only draft: real worker review protocol and SDK lifecycle;
// capture/submit are fixture adapters, not MainController token integration.
test('token review port forwards only the authenticated pre-POST capacity refusal', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  Object.assign(chrome.runtime, {
    id: 'pali-extension',
    getURL: (p = '') => `chrome-extension://pali-extension/${p}`,
  });
  try {
    const tokenAddress = `0x${'22'.repeat(20)}`;
    const data = new Interface([
      'function transfer(address,uint256)',
    ]).encodeFunctionData('transfer', [wallet.address, 1]);
    const rawTransaction = await wallet.signTransaction({
      type: 2,
      chainId: 7654321,
      nonce: 2,
      to: tokenAddress,
      data,
      value: 0,
      gasLimit: 100000,
      maxFeePerGas: 3,
      maxPriorityFeePerGas: 1,
    });
    const tx = Transaction.from(rawTransaction);
    const context = {
      account: { type: 'HDAccount' as const, id: 0, address: wallet.address },
      network: {
        kind: 'ethereum' as const,
        chainId: 7654321,
        slip44: 60,
        url: 'https://offline.invalid',
      },
      operation: 'erc20' as const,
    };
    const payload = { type: 'ERC20', transaction: {} };
    async function invokePort(submit: () => Promise<{ hash: string }>) {
      let onMessage: ((value: unknown) => void) | undefined;
      let onDisconnect: (() => void) | undefined;
      let failureResolve!: (value: any) => void;
      let readyResolve!: () => void;
      const ready = new Promise<void>((resolve) => {
        readyResolve = resolve;
      });
      const failure = new Promise<any>((resolve) => {
        failureResolve = resolve;
      });
      const port = {
        sender: {
          id: 'pali-extension',
          url: 'chrome-extension://pali-extension/app.html',
        },
        onMessage: {
          addListener: (fn: (value: unknown) => void) => {
            onMessage = fn;
          },
        },
        onDisconnect: {
          addListener: (fn: () => void) => {
            onDisconnect = fn;
          },
        },
        postMessage: (message: any) => {
          if (message.type === 'reviewed') readyResolve();
          else if (message.type === 'failure' || message.type === 'submitted')
            failureResolve(message);
        },
        disconnect: () => onDisconnect?.(),
      };
      watchWalletTokenReview(
        port as any,
        async () => ({
          payload: payload as any,
          nonce: 2,
          assertCurrent: () => {},
        }),
        async (_payload, approval) => {
          approval.assertCurrent();
          return submit();
        },
        controllerErrorResponse
      );
      try {
        expect(onMessage).toBeDefined();
        onMessage!({ type: 'fixture' });
        let readyTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            ready,
            new Promise<never>((_, reject) => {
              readyTimer = setTimeout(
                () => reject(Error('Synthetic review timed out')),
                5000
              );
            }),
          ]);
        } finally {
          clearTimeout(readyTimer);
        }
        onMessage!('submit');
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error('Synthetic port timed out')),
            5000
          );
        });
        let result: any;
        try {
          result = await Promise.race([failure, timeout]);
        } finally {
          clearTimeout(timer);
        }
        return result;
      } finally {
        onDisconnect?.();
      }
    }
    const full = fixture();
    const retained = await fill(full);
    const before = digest(full.get()),
      writes = full.writes();
    let posted = 0,
      captured: unknown;
    const attempt = async (
      target: ReturnType<typeof fixture>,
      afterAdmit: () => Promise<string>
    ) => {
      const boundary = captureEvmSubmission(
        context,
        target.session.assertCurrent,
        () =>
          createEvmSignedRecordLifecycle(target.store, target.session, {
            retirementReadForChain: null,
          })
      );
      return submitSignedEvmTransaction(
        rawTransaction,
        ({ admit }) => admit(afterAdmit),
        boundary,
        undefined,
        tx.unsignedSerialized
      );
    };
    const acknowledged = (value: unknown): { hash: string } => {
      if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
        throw new Error('Synthetic SDK acknowledgement invalid');
      return { hash: value };
    };
    const refusal = await invokePort(async () => {
      try {
        return acknowledged(
          await attempt(full, async () => {
            posted++;
            return tx.hash!;
          })
        );
      } catch (error) {
        captured = error;
        throw error;
      }
    });
    expect(refusal).toEqual({
      type: 'failure',
      success: false,
      error: {
        message: 'EVM_SIGNED_STORAGE_FULL',
        code: 'EVM_SIGNED_STORAGE_FULL',
        transactionNotBroadcast: true,
      },
    });
    expect(posted).toBe(0);
    expect(full.writes()).toBe(writes);
    expect(digest(full.get())).toBe(before);
    for (const previous of [retained.first, retained.second])
      expect(
        (
          await full.store.readExact(
            full.session,
            previous.chainId,
            previous.from,
            previous.hash
          )
        )?.rawTransaction === previous.rawTransaction
      ).toBe(true);
    const forged = await invokePort(async () => {
      throw Object.assign(new Error('synthetic'), {
        code: 'EVM_SIGNED_STORAGE_FULL',
        transactionNotBroadcast: true,
      });
    });
    expect(forged.error).not.toHaveProperty('code', 'EVM_SIGNED_STORAGE_FULL');
    const healthySuccess = fixture();
    const healthyReply = await invokePort(async () =>
      acknowledged(
        await attempt(healthySuccess, async () => {
          posted++;
          return tx.hash!;
        })
      )
    );
    expect(healthyReply.type).toBe('submitted');
    expect(healthyReply.hash === tx.hash).toBe(true);
    const healthy = fixture();
    const postDispatch = await invokePort(async () =>
      acknowledged(
        await attempt(healthy, async () => {
          posted++;
          throw captured;
        })
      )
    );
    expect(posted).toBe(2);
    expect(postDispatch.error).not.toHaveProperty(
      'code',
      'EVM_SIGNED_STORAGE_FULL'
    );
    expect(postDispatch.error).not.toHaveProperty(
      'transactionNotBroadcast',
      true
    );
  } finally {
    if (prior) Object.defineProperty(globalThis, 'crypto', prior);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
