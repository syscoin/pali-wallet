import {
  createInfrastructureJournal,
  infrastructurePendingIdentity,
  parseInfrastructureJournalEntry,
  type InfrastructureJournalEntry,
  type InfrastructureNetworkContext,
} from './infrastructureJournal.ts';

const attemptId = `0x${'11'.repeat(32)}`;
const transactionHash = `0x${'22'.repeat(32)}`;
const reservation = {
  attemptId,
  contractId: 'factory' as const,
  rpcUrl: 'https://rpc.example',
};

it('requires explicit host storage and RPC parsing policy', () => {
  expect(() =>
    Reflect.apply(createInfrastructureJournal, undefined, [{}])
  ).toThrow('storage is required');
  expect(() =>
    Reflect.apply(createInfrastructureJournal, undefined, [{ read: jest.fn() }])
  ).toThrow('storage is required');
  expect(() =>
    Reflect.apply(parseInfrastructureJournalEntry, undefined, [reservation])
  ).toThrow('RPC policy is required');
});

it('isolates fixed host stores while serializing same-chain aliases within one journal', async () => {
  const network = { chainId: 1, url: reservation.rpcUrl };
  const alias = { ...network, url: 'https://alias.example' };
  const store = () => {
    let current: InfrastructureJournalEntry | undefined;
    return {
      read: jest.fn(
        async (
          _context: InfrastructureNetworkContext,
          guard: (() => void) | null
        ) => {
          if (guard !== null) guard();
          return current;
        }
      ),
      write: jest.fn(
        async (
          _context: InfrastructureNetworkContext,
          entry: InfrastructureJournalEntry | null
        ) => {
          current = entry ?? undefined;
        }
      ),
    };
  };
  const firstStore = store(),
    secondStore = store();
  const first = createInfrastructureJournal(firstStore),
    second = createInfrastructureJournal(secondStore);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = firstStore.write.getMockImplementation()!;
  firstStore.write.mockImplementationOnce(async (context, entry) => {
    entered();
    await held;
    await write(context, entry);
  });
  const pending = first.write(network, reservation);
  await started;
  const competing = first.write(alias, {
    ...reservation,
    rpcUrl: alias.url,
    attemptId: transactionHash,
  });
  const rejected = expect(competing).rejects.toThrow(
    'Another infrastructure deployment is pending'
  );
  const otherAttempt = { ...reservation, attemptId: transactionHash };
  await second.write(network, otherAttempt);
  expect(await second.read(network, () => undefined)).toEqual(otherAttempt);
  expect(firstStore.read).toHaveBeenCalledTimes(1);
  release();
  await pending;
  await rejected;
  expect(await first.read(alias, () => undefined)).toEqual(reservation);
  expect(await second.read(network, () => undefined)).toEqual(otherAttempt);
});

it('keeps unknown no-hash attempts and the original stored object until catalogue observation resolves them', () => {
  const stored = {
    ...reservation,
    contractId: 'future-contract',
    retainedField: true,
  };
  expect(parseInfrastructureJournalEntry(stored, true)).toBe(stored);
  expect(
    infrastructurePendingIdentity(parseInfrastructureJournalEntry(stored, true))
  ).toBe(attemptId);
  expect(
    parseInfrastructureJournalEntry({ ...stored, transactionHash }, true)
  ).toEqual({ ...stored, transactionHash });
  expect(
    infrastructurePendingIdentity({ contractId: 'factory', transactionHash })
  ).toBe(transactionHash);
});

it('permits missing RPC only under the explicit legacy policy', () => {
  const legacy = { attemptId, contractId: 'factory' };
  expect(parseInfrastructureJournalEntry(legacy, false)).toBe(legacy);
  expect(() => parseInfrastructureJournalEntry(legacy, true)).toThrow(
    'Deployment journal is unreadable'
  );
  for (const rpcUrl of ['', null, 1])
    expect(() =>
      parseInfrastructureJournalEntry({ ...legacy, rpcUrl }, false)
    ).toThrow('Deployment journal is unreadable');
  for (const requireRpc of [false, true]) {
    expect(parseInfrastructureJournalEntry(null, requireRpc)).toBeUndefined();
    expect(
      parseInfrastructureJournalEntry(undefined, requireRpc)
    ).toBeUndefined();
  }
});

it.each([
  { contractId: 'factory', rpcUrl: reservation.rpcUrl },
  { ...reservation, attemptId: 'unknown' },
  { ...reservation, transactionHash: 'unknown' },
  { ...reservation, nonce: -1 },
  { ...reservation, nonce: Number.MAX_SAFE_INTEGER + 1 },
])('rejects unreadable durable attempt data %#', (value) => {
  expect(() => parseInfrastructureJournalEntry(value, true)).toThrow(
    'Deployment journal is unreadable'
  );
});
