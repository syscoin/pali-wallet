jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

import { chromeStorage } from 'utils/storageAPI';

import {
  clearInfrastructureJournal,
  InfrastructureJournalEntry,
  readInfrastructureJournal,
  writeInfrastructureJournal,
  infrastructureJournalStorageKey,
} from './infrastructureJournal';

const network = { chainId: 1, url: 'https://rpc-a.example' };
const otherChain = { chainId: 2, url: 'https://rpc-a.example' };
const otherFork = { chainId: 1, url: 'https://rpc-b.example' };
const hex32 = (byte: string) => `0x${byte.repeat(32)}`;
const reservation: InfrastructureJournalEntry = {
  attemptId: hex32('11'),
  contractId: 'accountImplementation',
  nonce: 7,
  payerAddress: `0x${'aa'.repeat(20)}`,
  rpcUrl: network.url,
};
const newer: InfrastructureJournalEntry = {
  ...reservation,
  attemptId: hex32('22'),
  contractId: 'factory',
  nonce: 8,
};

describe('durable infrastructure deployment journal', () => {
  let persisted: Map<string, InfrastructureJournalEntry | null>;

  beforeEach(() => {
    persisted = new Map();
    jest
      .mocked(chromeStorage.getItem)
      .mockReset()
      .mockImplementation(async (key) => persisted.get(key) ?? null);
    jest
      .mocked(chromeStorage.setItem)
      .mockReset()
      .mockImplementation(async (key, value) => {
        persisted.set(key, JSON.parse(JSON.stringify(value)));
      });
  });

  it('persists a no-hash attempt and upgrades that same attempt after acknowledgement', async () => {
    await writeInfrastructureJournal(network, reservation);
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      reservation
    );
    const acknowledged = { ...reservation, transactionHash: hex32('33') };
    await writeInfrastructureJournal(network, acknowledged);
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      acknowledged
    );
  });

  it('refuses to overwrite a different unresolved attempt', async () => {
    await writeInfrastructureJournal(network, reservation);
    await expect(writeInfrastructureJournal(network, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      reservation
    );
  });

  it('keeps same-chain RPC journals and clearing independent', async () => {
    const otherReservation = { ...newer, rpcUrl: otherFork.url };
    await writeInfrastructureJournal(network, reservation);
    await expect(readInfrastructureJournal(otherFork)).resolves.toBeUndefined();
    await writeInfrastructureJournal(otherFork, otherReservation);
    await clearInfrastructureJournal(otherFork, reservation);
    await expect(readInfrastructureJournal(otherFork)).resolves.toEqual(
      otherReservation
    );
    await clearInfrastructureJournal(otherFork, otherReservation);
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      reservation
    );
  });

  it('retains legacy chain-only entries without inferring or rewriting their RPC', async () => {
    const legacy = { ...reservation };
    delete legacy.rpcUrl;
    persisted.set('pali.infrastructure.pending.v1.1', legacy);
    for (const context of [network, otherFork]) {
      await expect(readInfrastructureJournal(context)).resolves.toEqual(legacy);
      await expect(
        writeInfrastructureJournal(context, {
          ...legacy,
          rpcUrl: context.url,
        })
      ).rejects.toThrow('Another infrastructure deployment is pending');
      await clearInfrastructureJournal(context, {
        ...legacy,
        rpcUrl: context.url,
      });
    }
    expect(persisted.get('pali.infrastructure.pending.v1.1')).toEqual(legacy);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
  });

  it.each([undefined, otherFork.url])(
    'fails closed on a scoped journal with mismatched RPC %s',
    async (rpcUrl) => {
      persisted.set(infrastructureJournalStorageKey(network), {
        ...reservation,
        rpcUrl,
      });
      await expect(readInfrastructureJournal(network)).rejects.toThrow(
        'Deployment journal is unreadable'
      );
      await expect(
        clearInfrastructureJournal(network, reservation)
      ).rejects.toThrow('Deployment journal is unreadable');
      expect(chromeStorage.setItem).not.toHaveBeenCalled();
    }
  );

  it('does not let a stale completion erase a newer attempt', async () => {
    await writeInfrastructureJournal(network, reservation);
    await clearInfrastructureJournal(network, reservation);
    await writeInfrastructureJournal(network, newer);
    await clearInfrastructureJournal(network, reservation);
    await expect(readInfrastructureJournal(network)).resolves.toEqual(newer);
    await clearInfrastructureJournal(network, newer);
    await expect(readInfrastructureJournal(network)).resolves.toBeUndefined();
  });

  it('keeps different chains independent while one storage write is delayed', async () => {
    let release!: () => void;
    let started!: () => void;
    const firstWriteStarted = new Promise<void>(
      (resolve) => (started = resolve)
    );
    const firstWrite = new Promise<void>((resolve) => (release = resolve));
    jest
      .mocked(chromeStorage.setItem)
      .mockImplementation(async (key, value) => {
        if (key === infrastructureJournalStorageKey(network)) {
          started();
          await firstWrite;
        }
        persisted.set(key, JSON.parse(JSON.stringify(value)));
      });
    const chainOne = writeInfrastructureJournal(network, reservation);
    await firstWriteStarted;
    await writeInfrastructureJournal(otherChain, newer);
    await expect(readInfrastructureJournal(otherChain)).resolves.toEqual(newer);
    release();
    await chainOne;
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      reservation
    );
  });

  it.each(['read', 'write', 'clear'])(
    'fails closed when the storage read for %s rejects',
    async (operation) => {
      await writeInfrastructureJournal(network, reservation);
      const writesBefore = jest.mocked(chromeStorage.setItem).mock.calls.length;
      jest
        .mocked(chromeStorage.getItem)
        .mockRejectedValueOnce(new Error('Storage read failed'));
      const result =
        operation === 'read'
          ? readInfrastructureJournal(network)
          : operation === 'write'
          ? writeInfrastructureJournal(network, newer)
          : clearInfrastructureJournal(network, reservation);
      await expect(result).rejects.toThrow('Storage read failed');
      expect(chromeStorage.setItem).toHaveBeenCalledTimes(writesBefore);
      await expect(readInfrastructureJournal(network)).resolves.toEqual(
        reservation
      );
    }
  );

  it('reports failed writes and releases the chain mutex for a later retry', async () => {
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage write failed'));
    await expect(
      writeInfrastructureJournal(network, reservation)
    ).rejects.toThrow('Storage write failed');
    await expect(readInfrastructureJournal(network)).resolves.toBeUndefined();
    await writeInfrastructureJournal(network, reservation);
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      reservation
    );
  });

  it('retains pending state when clearing storage fails', async () => {
    await writeInfrastructureJournal(network, reservation);
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage clear failed'));
    await expect(
      clearInfrastructureJournal(network, reservation)
    ).rejects.toThrow('Storage clear failed');
    await expect(readInfrastructureJournal(network)).resolves.toEqual(
      reservation
    );
    await expect(writeInfrastructureJournal(network, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
  });
});
