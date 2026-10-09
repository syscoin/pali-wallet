jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn() },
}));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock('./popup-promise', () => ({ popupPromise: jest.fn() }));
jest.mock('./request-pipeline', () => ({
  requestCoordinator: {
    coordinatePopupRequest: jest.fn((_context, open) => open()),
  },
}));

import { getController } from 'scripts/Background';
import store from 'state/store';

import { WalletMethodHandler } from './method-handlers';
import { popupPromise } from './popup-promise';
import {
  getStoredSendCallsBundle,
  recordSendCallsBundle,
  releaseSendCallsBundleReservation,
  reserveSendCallsBundle,
  resolveCallsStatus,
} from './sendCallsBundles';

const key = 'pali-sendcalls-bundles';
const host = 'https://dapp.example';
const id = '0x1234';
const token = 'attempt-a';
const submissionId = 'submission-a';
const hash = `0x${'12'.repeat(32)}`;
const descriptor = { atomic: false, chainId: 1, smartAccount: false };

describe('sendCalls reservation submission boundary', () => {
  let persisted: any;
  let readError: boolean;
  let writeError: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation();
    persisted = {};
    readError = false;
    writeError = false;
    (chrome.storage.local.get as jest.Mock).mockImplementation(
      (_keys, reply) => {
        (chrome.runtime as any).lastError = readError
          ? { message: 'Read failed' }
          : undefined;
        reply({ [key]: JSON.parse(JSON.stringify(persisted)) });
        (chrome.runtime as any).lastError = undefined;
      }
    );
    (chrome.storage.local.set as jest.Mock).mockImplementation(
      (items, reply) => {
        if (!writeError) persisted = JSON.parse(JSON.stringify(items[key]));
        (chrome.runtime as any).lastError = writeError
          ? { message: 'Write failed' }
          : undefined;
        reply();
        (chrome.runtime as any).lastError = undefined;
      }
    );
    (getController as jest.Mock).mockReturnValue({
      dapp: { getAccount: () => ({ address: 'payer' }) },
      wallet: {},
    });
    (store.getState as jest.Mock).mockReturnValue({
      vault: { activeNetwork: { chainId: 1 } },
      vaultGlobal: {},
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const reserve = () => reserveSendCallsBundle(host, id, descriptor, token);
  const begin = (reservationId = token) =>
    recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId,
      submissionId,
      submissionStarted: true,
      txHashes: [],
    });
  const context = () =>
    ({
      methodConfig: {
        hasPopup: true,
        popupRoute: 'send-calls',
        popupEventName: 'sendCalls',
      },
      originalRequest: {
        host,
        method: 'wallet_sendCalls',
        params: [{ id, calls: [] }],
        sender: { tab: { id: 1 }, documentId: 'original-document' },
        signal: new AbortController().signal,
      },
    } as any);

  it.each(['before submission', 'during submission', 'after hash'])(
    'handles requesting-document navigation %s without duplicate submission',
    async (stage) => {
      (popupPromise as jest.Mock).mockImplementation(async ({ data }) => {
        if (stage !== 'before submission') {
          await recordSendCallsBundle(host, id, {
            ...descriptor,
            reservationId: data.reservationId,
            submissionId,
            submissionStarted: true,
            txHashes: [],
          });
        }
        if (stage === 'after hash') {
          await recordSendCallsBundle(host, id, {
            ...descriptor,
            reservationId: data.reservationId,
            submissionId,
            txHashes: [hash],
          });
        }
        throw Error('Requesting document navigated');
      });
      const handler = new WalletMethodHandler();
      await expect(handler.handle(context())).rejects.toThrow('navigated');
      if (stage === 'before submission') {
        expect(await getStoredSendCallsBundle(host, id)).toBeNull();
        (popupPromise as jest.Mock).mockResolvedValueOnce({ id });
        await expect(handler.handle(context())).resolves.toEqual({ id });
      } else {
        await expect(handler.handle(context())).rejects.toMatchObject({
          code: 5720,
        });
        expect(popupPromise).toHaveBeenCalledTimes(1);
        expect(await getStoredSendCallsBundle(host, id)).toMatchObject({
          txHashes: stage === 'after hash' ? [hash] : [],
        });
      }
    }
  );

  it('rejects delayed begin/progress and ignores cleanup from a replaced reservation', async () => {
    await reserve();
    await releaseSendCallsBundleReservation(host, id, token);
    await reserveSendCallsBundle(host, id, descriptor, 'attempt-b');
    await expect(begin()).rejects.toThrow('reservation is unavailable');
    await expect(
      recordSendCallsBundle(host, id, {
        ...descriptor,
        reservationId: token,
        submissionId,
        txHashes: [hash],
      })
    ).rejects.toThrow('reservation is unavailable');
    await releaseSendCallsBundleReservation(host, id, token);
    expect(persisted[host][id].reservationId).toBe('attempt-b');
    expect(persisted[host][id].submissionStarted).toBeUndefined();
  });

  it('rejects a begin marker for another network', async () => {
    await reserve();
    await expect(
      recordSendCallsBundle(host, id, {
        ...descriptor,
        chainId: 2,
        reservationId: token,
        submissionId,
        submissionStarted: true,
        txHashes: [],
      })
    ).rejects.toThrow('network changed');
    expect(persisted[host][id].submissionStarted).toBeUndefined();
  });

  it('preserves known hashes and the submission marker across progress snapshots', async () => {
    await reserve();
    await begin();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      txHashes: [hash],
    });
    await begin();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      failed: true,
      txHashes: [],
    });
    await releaseSendCallsBundleReservation(host, id, token);
    expect(persisted[host][id]).toMatchObject({
      submissionStarted: true,
      txHashes: [hash],
    });
  });

  it('never expires or evicts an unknown submission to admit another request', async () => {
    for (let index = 0; index < 50; index += 1) {
      const bundleId = `0x${index.toString(16)}`;
      await reserveSendCallsBundle(host, bundleId, descriptor, token);
      await recordSendCallsBundle(host, bundleId, {
        ...descriptor,
        reservationId: token,
        submissionId,
        submissionStarted: true,
        txHashes: [],
      });
    }
    persisted[host]['0x0'].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(await reserveSendCallsBundle(host, '0x0', descriptor, 'new')).toBe(
      false
    );
    await expect(
      reserveSendCallsBundle(host, '0xffff', descriptor, 'new')
    ).rejects.toThrow('Too many unresolved');
    expect(Object.keys(persisted[host])).toHaveLength(50);
    expect(persisted[host]['0x0'].submissionStarted).toBe(true);
  });

  it('rejects failed storage reads instead of treating a protected id as absent', async () => {
    await reserve();
    await begin();
    readError = true;
    await expect(reserve()).rejects.toThrow('Unable to read');
    await expect(
      releaseSendCallsBundleReservation(host, id, token)
    ).rejects.toThrow('Unable to read');
    expect(persisted[host][id].submissionStarted).toBe(true);
  });

  it('rejects a failed durable begin write before the popup may invoke a sender', async () => {
    await reserve();
    writeError = true;
    await expect(begin()).rejects.toThrow('Unable to persist');
    expect(persisted[host][id].submissionStarted).toBeUndefined();
  });

  it('keeps a partially recorded batch pending and pinned until explicit completion', async () => {
    await reserve();
    await begin();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      txHashes: [hash],
    });
    persisted[host][id].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    for (let index = 0; index < 60; index += 1)
      await reserveSendCallsBundle(host, `0xff${index}`, descriptor, token);
    expect(persisted[host][id].txHashes).toEqual([hash]);
    expect(await reserve()).toBe(false);
    const provider = {
      getTransactionReceipt: async () => ({
        status: 1,
        blockNumber: 1,
        gasUsed: 1,
        transactionHash: hash,
      }),
    };
    expect((await resolveCallsStatus(() => provider, host, id)).status).toBe(
      100
    );
    persisted[host][id].createdAt = Date.now();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      submissionCompleted: true,
      failed: false,
      txHashes: [hash],
    });
    // Late progress cannot undo the terminal result.
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      failed: true,
      txHashes: [],
    });
    expect((await resolveCallsStatus(() => provider, host, id)).status).toBe(
      200
    );
    expect(persisted[host][id].failed).toBe(false);
    persisted[host][id].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await reserveSendCallsBundle(host, '0xffff', descriptor, token);
    expect(persisted[host][id]).toBeUndefined();
  });

  it('releases a proven no-broadcast failure but never erases an acknowledged hash', async () => {
    await reserve();
    await begin();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      submissionNotBroadcast: true,
      txHashes: [],
    });
    await releaseSendCallsBundleReservation(host, id, token);
    expect(await getStoredSendCallsBundle(host, id)).toBeNull();
    await reserve();
    await begin();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      txHashes: [hash],
    });
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      submissionNotBroadcast: true,
      txHashes: [],
    });
    await releaseSendCallsBundleReservation(host, id, token);
    expect(persisted[host][id]).toMatchObject({
      txHashes: [hash],
      submissionStarted: true,
    });
  });

  it('reopens only a fresh submission and rejects stale begin, rejection and completion messages', async () => {
    await reserve();
    await begin();
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId,
      failed: true,
      submissionCompleted: true,
      txHashes: [hash],
    });
    const provider = {
      getTransactionReceipt: async () => ({
        status: 1,
        blockNumber: 1,
        gasUsed: 1,
        transactionHash: hash,
      }),
    };
    expect((await resolveCallsStatus(() => provider, host, id)).status).toBe(
      600
    );
    await begin();
    expect(persisted[host][id].submissionCompleted).toBe(true);
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId: 'submission-b',
      previousSubmissionId: submissionId,
      submissionStarted: true,
      txHashes: [],
    });
    expect((await resolveCallsStatus(() => provider, host, id)).status).toBe(
      100
    );
    await expect(begin()).rejects.toThrow('submission changed');
    for (const stale of [
      { submissionNotBroadcast: true },
      { submissionCompleted: true, failed: true },
    ])
      await expect(
        recordSendCallsBundle(host, id, {
          ...descriptor,
          reservationId: token,
          submissionId,
          txHashes: [],
          ...stale,
        })
      ).rejects.toThrow('submission changed');
    expect(persisted[host][id]).toMatchObject({
      submissionId: 'submission-b',
      submissionCompleted: false,
      txHashes: [hash],
    });
    await recordSendCallsBundle(host, id, {
      ...descriptor,
      reservationId: token,
      submissionId: 'submission-b',
      submissionCompleted: true,
      failed: false,
      txHashes: [hash],
    });
    expect((await resolveCallsStatus(() => provider, host, id)).status).toBe(
      200
    );
  });
});
