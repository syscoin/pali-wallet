import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import {
  captureEvmSubmission,
  evmSubmissionFailure,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { Wallet, Transaction } from 'ethers';
import { createHash, webcrypto } from 'node:crypto';

import {
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
  type EvmSignedRecordStorage,
  type EvmSignedRecordSession,
} from '../../../wallet/evmSignedRecords';

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
      () => createEvmSignedRecordLifecycle(full.store, full.session)
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
        () => createEvmSignedRecordLifecycle(full.store, full.session)
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
        () => createEvmSignedRecordLifecycle(clean.store, clean.session)
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
        () => createEvmSignedRecordLifecycle(reused.store, reused.session)
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
          createEvmSignedRecordLifecycle(beforeAdmit.store, beforeAdmit.session)
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
