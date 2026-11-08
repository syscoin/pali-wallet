import { captureSmartAccountCallsIdentity } from '../shared/dappCallsStatus';
import { buildSmartAccountUserOperation } from '../utils/smartAccount/account';
import { paliEntryPointInterface } from '../utils/smartAccount/contracts';

import {
  createCallsBundleRegistry,
  type CallsBundleStore,
  type CallsBundlePorts,
} from './dappCallsBundles';

const host = 'https://app.example';
const sender = `0x${'11'.repeat(20)}`;
const hash = `0x${'22'.repeat(32)}`;
const otherHash = `0x${'33'.repeat(32)}`;
const blockHash = `0x${'ab'.repeat(32)}`;
const orphanedBlockHash = `0x${'55'.repeat(32)}`;
const descriptor = { atomic: false, smartAccount: false, chainId: 1 };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const gate = () => {
  let release!: () => void;
  let arrive!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return { promise, release, entered, arrive };
};

function fixture() {
  let live = true,
    time = 100;
  let data: CallsBundleStore = {};
  let readGate: ReturnType<typeof gate> | undefined;
  let writeGate: ReturnType<typeof gate> | undefined;
  const ports: CallsBundlePorts = {
    assertCurrent() {
      if (!live) throw new Error('Retired owner');
    },
    now: () => time,
    randomBytes: (length) => new Uint8Array(length).fill(1),
    storage: {
      async read() {
        const held = readGate;
        readGate = undefined;
        held?.arrive();
        await held?.promise;
        return clone(data);
      },
      async write(next, check) {
        const held = writeGate;
        writeGate = undefined;
        held?.arrive();
        await held?.promise;
        check();
        data = clone(next);
      },
    },
  };
  const registry = createCallsBundleRegistry(ports);
  const reserve = (id = '0x01') =>
    registry.reserveSendCallsBundle(host, id, descriptor, 'reserved', sender);
  const begin = () =>
    registry.recordSendCallsBundle(host, '0x01', {
      ...descriptor,
      reservationId: 'reserved',
      submissionId: 'submitted',
      submissionStarted: true,
      txHashes: [],
    });
  return {
    registry,
    ports,
    reserve,
    begin,
    data: () => data,
    retire() {
      live = false;
    },
    tick() {
      time += 8 * 24 * 60 * 60 * 1000;
    },
    holdRead() {
      return (readGate = gate());
    },
    holdWrite() {
      return (writeGate = gate());
    },
  };
}

const minedReceipt = (transactionHash = hash, status = 1) => ({
  hash: transactionHash,
  status,
  blockHash,
  blockNumber: 7,
  gasUsed: BigInt(21000),
  logs: [] as any[],
});

async function statusFixture(
  state: 'completed' | 'stopped' | 'started',
  txHashes = [hash],
  failed = false
) {
  const f = fixture();
  await f.reserve();
  await f.begin();
  await f.registry.recordSendCallsBundle(host, '0x01', {
    ...descriptor,
    reservationId: 'reserved',
    submissionId: 'submitted',
    submissionCompleted: state === 'completed',
    failed,
    txHashes,
  });
  // Seed the supported durable stopped snapshot. Authentication of this marker
  // is covered separately by the retained signed-attempt lifecycle controls.
  if (state === 'stopped')
    f.data()[host]!['0x01']!.stoppedTransactionHash = txHashes[0];
  const provider = {
    getTransactionReceipt: jest.fn(async (tx: string) => minedReceipt(tx)),
    getBlockHash: jest
      .fn<Promise<string | null>, [string]>()
      .mockResolvedValue(blockHash),
  };
  const rpc = {
    assertCurrent: f.ports.assertCurrent,
    forChain: jest.fn(() => provider),
  };
  return {
    ...f,
    provider,
    rpc,
    read: () => f.registry.resolveCallsStatus(rpc, host, '0x01'),
  };
}

it('requires explicit owner, storage, clock and random ports', async () => {
  const f = fixture();
  for (const name of ['assertCurrent', 'now', 'randomBytes', 'storage']) {
    expect(() =>
      createCallsBundleRegistry({ ...f.ports, [name]: undefined } as any)
    ).toThrow('storage is unavailable');
  }
  const asyncGuard = createCallsBundleRegistry({
    ...f.ports,
    assertCurrent: async () => undefined,
  });
  await expect(
    asyncGuard.getStoredSendCallsBundle(host, '0x01')
  ).rejects.toThrow('owner changed');
  expect(f.registry.generateWalletBundleId()).toBe('0x' + '01'.repeat(32));
});

it('serializes duplicate reservation and preserves an unfinished attempt over restart and expiry', async () => {
  const f = fixture();
  expect(await Promise.all([f.reserve(), f.reserve()])).toEqual([true, false]);
  await f.begin();
  f.tick();
  const restarted = createCallsBundleRegistry(f.ports);
  expect(
    await restarted.reserveSendCallsBundle(
      host,
      '0x01',
      descriptor,
      'another',
      sender
    )
  ).toBe(false);
  expect(
    await restarted.resolveCallsStatus(
      {
        assertCurrent: f.ports.assertCurrent,
        forChain: () => {
          throw new Error('No RPC expected');
        },
      },
      host,
      '0x01'
    )
  ).toMatchObject({ status: 100, chainId: '0x1' });
  await restarted.releaseSendCallsBundleReservation(host, '0x01', 'reserved');
  expect(await restarted.getStoredSendCallsBundle(host, '0x01')).not.toBeNull();
});

it('rejects owner loss during read and checks the same owner at the commit boundary', async () => {
  for (const phase of ['read', 'write'] as const) {
    const f = fixture();
    const held = phase === 'read' ? f.holdRead() : f.holdWrite();
    const pending = expect(f.reserve()).rejects.toThrow('Retired owner');
    await held.entered;
    f.retire();
    held.release();
    await pending;
    expect(f.data()).toEqual({});
  }
  const retired = fixture();
  retired.retire();
  await expect(retired.reserve()).rejects.toThrow('Retired owner');
});

it('captures reservation and progress inputs before waiting on storage', async () => {
  const f = fixture(),
    held = f.holdRead();
  const initial = { ...descriptor };
  const reservation = f.registry.reserveSendCallsBundle(
    host,
    '0x01',
    initial,
    'reserved',
    sender
  );
  initial.chainId = 2;
  held.release();
  await reservation;
  expect(
    (await f.registry.getStoredSendCallsBundle(host, '0x01'))?.chainId
  ).toBe(1);
  const pausedRead = f.holdRead();
  const progress = {
    ...descriptor,
    reservationId: 'reserved',
    txHashes: [hash],
  };
  const writing = f.registry.recordSendCallsBundle(host, '0x01', progress);
  progress.txHashes.length = 0;
  progress.chainId = 2;
  pausedRead.release();
  await writing;
  expect(
    (await f.registry.getStoredSendCallsBundle(host, '0x01'))?.txHashes
  ).toEqual([hash]);
});

it('resolves receipts through the bundle chain and rejects a retired query', async () => {
  const f = fixture();
  await f.reserve();
  await f.begin();
  await f.registry.recordSendCallsBundle(host, '0x01', {
    ...descriptor,
    reservationId: 'reserved',
    submissionId: 'submitted',
    submissionCompleted: true,
    txHashes: [hash],
  });
  const held = gate();
  let current = true;
  const rpc = {
    assertCurrent() {
      if (!current) throw new Error('Retired query');
    },
    forChain: jest.fn((chain: number) => ({
      async getBlockHash() {
        return hash;
      },
      async getTransactionReceipt(tx: string) {
        expect(chain).toBe(1);
        expect(tx).toBe(hash);
        held.arrive();
        await held.promise;
        return {
          hash,
          status: 1,
          blockHash: hash,
          blockNumber: 7,
          gasUsed: BigInt(21000),
          logs: [],
        };
      },
    })),
  };
  const reading = expect(
    f.registry.resolveCallsStatus(rpc, host, '0x01')
  ).rejects.toThrow('Retired query');
  await held.entered;
  current = false;
  held.release();
  await reading;
  expect(rpc.forChain).toHaveBeenCalledWith(1);
  await expect(
    f.registry.resolveCallsStatus(
      { assertCurrent: f.ports.assertCurrent, forChain: () => null },
      host,
      '0x01'
    )
  ).rejects.toMatchObject({ code: 5710 });
  await expect(
    f.registry.resolveCallsStatus(
      { assertCurrent: f.ports.assertCurrent, forChain: () => null },
      'https://other.example',
      '0x01'
    )
  ).rejects.toMatchObject({ code: 5730 });
});

describe.each(['completed', 'stopped'] as const)(
  '%s bundle canonical receipts',
  (state) => {
    it.each([0, 1])(
      'returns the canonical mined outcome %s',
      async (status) => {
        const f = await statusFixture(state);
        f.provider.getTransactionReceipt.mockResolvedValue(
          minedReceipt(hash, status)
        );
        expect(await f.read()).toMatchObject({
          status: status ? 200 : 500,
          receipts: [
            { transactionHash: hash, blockHash, status: `0x${status}` },
          ],
        });
        expect(f.provider.getBlockHash).toHaveBeenCalledTimes(1);
        expect(f.provider.getBlockHash).toHaveBeenCalledWith('0x7');
      }
    );

    it.each([0, 1])(
      'keeps orphaned outcome %s pending and omits the orphaned receipt',
      async (status) => {
        const f = await statusFixture(state);
        f.provider.getTransactionReceipt.mockResolvedValue(
          minedReceipt(hash, status)
        );
        f.provider.getBlockHash.mockResolvedValue(orphanedBlockHash);
        const result = await f.read();
        expect(result.status).toBe(100);
        expect(result.receipts).toBeUndefined();
      }
    );

    it.each([null, 'invalid', new Error('Header unavailable')])(
      'keeps an unavailable canonical header %p pending without a receipt',
      async (header) => {
        const f = await statusFixture(state);
        f.provider.getBlockHash.mockImplementation(async () => {
          if (header instanceof Error) throw header;
          return header;
        });
        const result = await f.read();
        expect(result.status).toBe(100);
        expect(result.receipts).toBeUndefined();
      }
    );

    it('does not query a header when the receipt RPC fails', async () => {
      const f = await statusFixture(state);
      f.provider.getTransactionReceipt.mockRejectedValue(
        new Error('Receipt unavailable')
      );
      expect(await f.read()).toMatchObject({ status: 100 });
      expect(f.provider.getBlockHash).not.toHaveBeenCalled();
    });

    it('returns only canonical receipts when a bundle spans competing blocks at one height', async () => {
      const f = await statusFixture(state, [hash, otherHash]);
      f.provider.getTransactionReceipt.mockImplementation(async (tx) => ({
        ...minedReceipt(tx),
        blockHash: tx === hash ? blockHash : orphanedBlockHash,
      }));
      const result = await f.read();
      expect(result.status).toBe(100);
      expect(
        result.receipts?.map((receipt) => receipt.transactionHash)
      ).toEqual([hash]);
      expect(f.provider.getBlockHash).toHaveBeenCalledTimes(1);
    });

    it('deduplicates canonical headers within a query and refreshes them on the next query', async () => {
      const f = await statusFixture(state, [hash, otherHash]);
      expect((await f.read()).status).toBe(200);
      expect(f.provider.getBlockHash).toHaveBeenCalledTimes(1);
      f.provider.getBlockHash.mockResolvedValue(orphanedBlockHash);
      const reorged = await f.read();
      expect(reorged.status).toBe(100);
      expect(reorged.receipts).toBeUndefined();
      expect(f.provider.getBlockHash).toHaveBeenCalledTimes(2);
      f.provider.getBlockHash.mockResolvedValue(
        blockHash.toUpperCase().replace('0X', '0x')
      );
      expect((await f.read()).status).toBe(200);
      expect(f.provider.getBlockHash).toHaveBeenCalledTimes(3);
    });
  }
);

it.each(['completed', 'stopped'] as const)(
  'preserves the partial-broadcast failure outcome for canonical %s receipts',
  async (state) => {
    const f = await statusFixture(state, [hash], true);
    expect((await f.read()).status).toBe(600);
  }
);

it('keeps a live sequence pending even when its recorded prefix is canonical', async () => {
  const f = await statusFixture('started');
  expect(await f.read()).toMatchObject({
    status: 100,
    receipts: [{ transactionHash: hash, blockHash }],
  });
});

it.each(['completed', 'stopped'] as const)(
  'preserves malformed-receipt handling for a %s bundle',
  async (state) => {
    const f = await statusFixture(state);
    f.provider.getTransactionReceipt.mockResolvedValue(minedReceipt(otherHash));
    if (state === 'completed')
      await expect(f.read()).rejects.toThrow('receipt hash changed');
    else {
      const result = await f.read();
      expect(result.status).toBe(100);
      expect(result.receipts).toBeUndefined();
    }
    expect(f.provider.getBlockHash).not.toHaveBeenCalled();
  }
);

it.each([false, true])(
  'checks query and owner cancellation after a canonical header %s failure',
  async (fail) => {
    for (const scope of ['query', 'owner'] as const) {
      const f = await statusFixture('completed');
      const held = gate();
      let current = true;
      f.rpc.assertCurrent = () => {
        if (!current) throw new Error('Retired query');
      };
      f.provider.getBlockHash.mockImplementation(async () => {
        held.arrive();
        await held.promise;
        if (fail) throw new Error('Header unavailable');
        return blockHash;
      });
      const pending = expect(f.read()).rejects.toThrow(
        scope === 'query' ? 'Retired query' : 'Retired owner'
      );
      await held.entered;
      if (scope === 'query') current = false;
      else f.retire();
      held.release();
      await pending;
    }
  }
);

it('rejects an asynchronous query guard before making an RPC request', async () => {
  const f = await statusFixture('completed');
  f.rpc.assertCurrent = async () => undefined;
  await expect(f.read()).rejects.toThrow('Calls status owner changed');
  expect(f.rpc.forChain).not.toHaveBeenCalled();
});

it.each([
  'stoppedTransactionHash',
  'submissionStarted',
  'submissionCompleted',
  'failed',
  'hash count',
  'hash order',
])(
  'preserves the stopped snapshot fence when %s changes during the header read',
  async (field) => {
    const f = await statusFixture('stopped', [hash, otherHash]);
    f.provider.getBlockHash.mockImplementation(async () => {
      const bundle = f.data()[host]!['0x01']!;
      if (field === 'stoppedTransactionHash')
        delete bundle.stoppedTransactionHash;
      else if (field === 'submissionStarted') bundle.submissionStarted = false;
      else if (field === 'submissionCompleted')
        bundle.submissionCompleted = true;
      else if (field === 'failed') bundle.failed = true;
      else if (field === 'hash count')
        bundle.txHashes.push(`0x${'66'.repeat(32)}`);
      else bundle.txHashes.reverse();
      return blockHash;
    });
    expect((await f.read()).status).toBe(100);
  }
);

it.each([false, true])(
  'requires canonical smart-account inner outcome %s',
  async (success) => {
    const f = fixture();
    const smart = { ...descriptor, atomic: true, smartAccount: true };
    const identity = captureSmartAccountCallsIdentity(
      buildSmartAccountUserOperation({ sender, nonce: '0', callData: '0x' }),
      1
    );
    await f.registry.reserveSendCallsBundle(
      host,
      '0x01',
      smart,
      'reserved',
      sender
    );
    await f.registry.recordSendCallsBundle(host, '0x01', {
      ...smart,
      reservationId: 'reserved',
      submissionId: 'submitted',
      submissionStarted: true,
      smartAccountIdentity: identity,
      txHashes: [],
    });
    await f.registry.recordSendCallsBundle(host, '0x01', {
      ...smart,
      reservationId: 'reserved',
      submissionId: 'submitted',
      submissionCompleted: true,
      txHashes: [hash],
    });
    const log = paliEntryPointInterface.encodeEventLog(
      paliEntryPointInterface.getEvent('UserOperationEvent')!,
      [identity.userOpHash, sender, `0x${'00'.repeat(20)}`, 0, success, 1, 1]
    );
    const provider = {
      getTransactionReceipt: async () => ({
        ...minedReceipt(),
        logs: [{ address: identity.entryPoint, ...log }],
      }),
      getBlockHash: jest.fn(async () => orphanedBlockHash),
    };
    const read = () =>
      f.registry.resolveCallsStatus(
        {
          assertCurrent: f.ports.assertCurrent,
          forChain: () => provider,
        },
        host,
        '0x01'
      );
    const orphaned = await read();
    expect(orphaned.status).toBe(100);
    expect(orphaned.receipts).toBeUndefined();
    provider.getBlockHash.mockResolvedValue(blockHash);
    expect((await read()).status).toBe(success ? 200 : 500);
  }
);
