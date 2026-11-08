/** @jest-environment node */
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItems: jest.fn(), setItem: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-keyring', () => {
  const sdk = jest.requireActual(
    '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js'
  );
  return {
    captureEvmSubmission: sdk.captureEvmSubmission,
    submitSignedEvmTransaction: sdk.submitSignedEvmTransaction,
  };
});

import {
  decryptPrivateRecordBytes,
  encryptPrivateRecordBytes,
  privateRecordProfileId,
} from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import { snapshotPreparedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-envelope.js';
import {
  captureEvmSubmission,
  evmSubmissionFailure,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { webcrypto } from 'crypto';
import { Transaction } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';

import {
  EvmSignedRecords,
  createEvmSignedRecordLifecycle,
} from '../../../../wallet/evmSignedRecords';
import { createChromeEvmSignedRecordStorage } from '../evmSignedRecords';
import { walletPersistenceGate } from 'state/paliStorage';
import { chromeStorage } from 'utils/storageAPI';

import {
  captureEoaCallsSignedMetadata,
  bindEoaCallsSignedLifecycle,
  getStoredSendCallsBundle,
  recordSendCallsBundle,
  recoverStoppedEoaCalls,
  reserveSendCallsBundle,
  settleEoaCallsSignedSubmission,
  resolveCallsStatus,
} from './sendCallsBundles';

const signer = new Wallet('0x' + '11'.repeat(32));
const origin = 'https://app.example',
  id = '0x01',
  reservationId = 'reservation',
  submissionId = 'submission';
let bundles: Record<string, unknown>, disk: Record<string, unknown>;
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  walletPersistenceGate.blocked = false;
  bundles = {};
  disk = {};
  (chrome.storage.local.get as jest.Mock).mockImplementation((_keys, reply) =>
    reply({ 'pali-sendcalls-bundles': JSON.parse(JSON.stringify(bundles)) })
  );
  (chrome.storage.local.set as jest.Mock).mockImplementation((items, reply) => {
    bundles = JSON.parse(JSON.stringify(items['pali-sendcalls-bundles']));
    reply();
  });
  jest
    .mocked(chromeStorage.getItems)
    .mockImplementation(async () => ({ ...disk }));
  jest.mocked(chromeStorage.setItem).mockImplementation(async (key, value) => {
    disk[key] = value;
  });
});

async function fixture(failed: boolean, refusePreflight = false) {
  const key = new Uint8Array(32).fill(42);
  let live = true;
  const session = {
    assertCurrent: () => undefined,
    keyring: {
      getPrivateRecordProfileId: () =>
        privateRecordProfileId(key, () => undefined),
      encryptPrivateRecord: (
        input: Parameters<typeof encryptPrivateRecordBytes>[1]
      ) => encryptPrivateRecordBytes(key, input, () => undefined),
      decryptPrivateRecord: (
        input: Parameters<typeof decryptPrivateRecordBytes>[1]
      ) => decryptPrivateRecordBytes(key, input, () => undefined),
    },
  };
  const transaction = snapshotPreparedEvmTransaction({
    from: signer.address,
    to: '0x' + '22'.repeat(20),
    chainId: '1',
    nonce: '0',
    value: '1',
    data: '0x',
    gasLimit: '21000',
    type: 2,
    accessList: [],
    maxFeePerGas: '3',
    maxPriorityFeePerGas: '1',
  });
  const rawTransaction = await signer.signTransaction({
    chainId: 1,
    nonce: 0,
    to: transaction.to,
    value: 1,
    gasLimit: 21000,
    type: 2,
    maxFeePerGas: 3,
    maxPriorityFeePerGas: 1,
  });
  const hash = Transaction.from(rawTransaction).hash!;
  await reserveSendCallsBundle(
    origin,
    id,
    { atomic: false, smartAccount: false, chainId: 1 },
    reservationId,
    signer.address
  );
  await recordSendCallsBundle(origin, id, {
    atomic: false,
    smartAccount: false,
    chainId: 1,
    reservationId,
    submissionId,
    submissionStarted: true,
    txHashes: [],
  });
  const metadata = await captureEoaCallsSignedMetadata(
    { origin, bundleId: id, reservationId, submissionId, failed },
    transaction
  );
  const records = new EvmSignedRecords(createChromeEvmSignedRecordStorage());
  const context = {
    account: { id: 0, type: 'HDAccount', address: signer.address },
    network: {
      kind: 'ethereum',
      chainId: 1,
      slip44: 60,
      url: 'https://offline.invalid',
    },
    operation: 'send' as const,
  };
  const boundary = captureEvmSubmission(context, session.assertCurrent, () =>
    bindEoaCallsSignedLifecycle(
      createEvmSignedRecordLifecycle(records, session, {
        metadata,
        retirementReadForChain: null,
        preflight: async () => {
          if (refusePreflight) throw new Error('Fresh fee review required');
        },
      }),
      metadata.eoaCalls
    )
  );
  return {
    session,
    records,
    boundary,
    attempt: metadata.eoaCalls,
    hash,
    rawTransaction,
    retire: () => {
      live = false;
    },
    assertStopped: () => {
      if (live) throw new Error('Sequence remains live');
    },
  };
}

it.each([false, true])(
  'Chrome association survives wire entry before ACK, with remaining suffix %s',
  async (failed) => {
    const f = await fixture(failed),
      entered = Promise.withResolvers<void>(),
      ack = Promise.withResolvers<string>();
    let wires = 0;
    const send = submitSignedEvmTransaction(
      f.rawTransaction,
      ({ admit }) =>
        admit(() => {
          expect((bundles[origin] as any)[id].txHashes).toEqual([f.hash]);
          wires++;
          entered.resolve();
          return ack.promise;
        }),
      f.boundary,
      undefined,
      Transaction.from(f.rawTransaction).unsignedSerialized
    );
    void send.catch(() => undefined);
    await entered.promise;
    expect((await getStoredSendCallsBundle(origin, id))!.txHashes).toEqual([
      f.hash,
    ]);
    const reopened = new EvmSignedRecords(createChromeEvmSignedRecordStorage());
    await expect(
      recoverStoppedEoaCalls(reopened, f.session, origin, id, f.assertStopped)
    ).rejects.toThrow('live');
    f.retire();
    await recoverStoppedEoaCalls(
      reopened,
      f.session,
      origin,
      id,
      f.assertStopped
    );
    expect((await getStoredSendCallsBundle(origin, id))!.txHashes).toEqual([
      f.hash,
    ]);
    const blockHash = '0x' + 'ab'.repeat(32);
    const result = await resolveCallsStatus(
      () => ({
        getTransactionReceipt: async (hash: string) => ({
          hash,
          status: 1,
          blockHash,
          blockNumber: 7,
          gasUsed: BigInt(21000),
          logs: [],
        }),
        getBlock: async () => ({ hash: blockHash }),
      }),
      origin,
      id
    );
    expect(result.status).toBe(failed ? 600 : 200);
    expect(wires).toBe(1);
    ack.reject(new Error('Lost ACK'));
    await expect(send).rejects.toThrow();
  }
);

it('Chrome SDK final-guard refusal retracts only the branded unsent association', async () => {
  const f = await fixture(false);
  let wires = 0;
  const work = submitSignedEvmTransaction(
    f.rawTransaction,
    ({ admit }) =>
      admit(async () => {
        wires++;
        return f.hash;
      }),
    f.boundary,
    () => {
      throw new Error('Final owner guard retired');
    },
    Transaction.from(f.rawTransaction).unsignedSerialized
  );
  await expect(settleEoaCallsSignedSubmission(work, f.attempt)).rejects.toThrow(
    'retired'
  );
  expect(wires).toBe(0);
  expect((await getStoredSendCallsBundle(origin, id))!.txHashes).toEqual([]);
});

it('Chrome final preflight refusal retracts the proven unsent association', async () => {
  const f = await fixture(false, true);
  let wires = 0,
    refused = false;
  try {
    await submitSignedEvmTransaction(
      f.rawTransaction,
      ({ admit }) =>
        admit(async () => {
          wires++;
          return f.hash;
        }),
      f.boundary,
      undefined,
      Transaction.from(f.rawTransaction).unsignedSerialized
    );
  } catch (error) {
    refused = true;
    expect(evmSubmissionFailure(error)?.transactionNotBroadcast).toBe(true);
  }
  expect(refused).toBe(true);
  expect(wires).toBe(0);
  expect((await getStoredSendCallsBundle(origin, id))!.txHashes).toEqual([]);
});

it.each(['signed journal', 'bundle metadata'])(
  'Chrome %s refusal prevents wire dispatch',
  async (target) => {
    const f = await fixture(false);
    if (target === 'signed journal')
      jest
        .mocked(chromeStorage.setItem)
        .mockRejectedValue(new Error('Storage refused'));
    else
      (chrome.storage.local.set as jest.Mock).mockImplementation(
        (_items, reply) => {
          (chrome.runtime as any).lastError = { message: 'Storage refused' };
          reply();
          (chrome.runtime as any).lastError = undefined;
        }
      );
    let wires = 0;
    let refused = false;
    try {
      await submitSignedEvmTransaction(
        f.rawTransaction,
        ({ admit }) =>
          admit(async () => {
            wires++;
            return f.hash;
          }),
        f.boundary,
        undefined,
        Transaction.from(f.rawTransaction).unsignedSerialized
      );
    } catch (error) {
      refused = true;
      expect(evmSubmissionFailure(error)?.transactionNotBroadcast).toBe(true);
    }
    expect(refused).toBe(true);
    expect(wires).toBe(0);
  }
);
