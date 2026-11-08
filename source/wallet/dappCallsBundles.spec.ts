import {
  createCallsBundleRegistry,
  type CallsBundleStore,
  type CallsBundlePorts,
} from './dappCallsBundles';

const host = 'https://app.example';
const sender = `0x${'11'.repeat(20)}`;
const hash = `0x${'22'.repeat(32)}`;
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
