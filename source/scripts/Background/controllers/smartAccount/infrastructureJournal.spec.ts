jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));

import { chromeStorage } from 'utils/storageAPI';

import {
  clearInfrastructureJournal,
  InfrastructureJournalEntry,
  readInfrastructureJournal,
  writeInfrastructureJournal,
} from './infrastructureJournal';

const hex32 = (byte: string) => `0x${byte.repeat(32)}`;
const reservation: InfrastructureJournalEntry = {
  attemptId: hex32('11'),
  contractId: 'accountImplementation',
  nonce: 7,
  payerAddress: `0x${'aa'.repeat(20)}`,
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
    await writeInfrastructureJournal(1, reservation);
    await expect(readInfrastructureJournal(1)).resolves.toEqual(reservation);
    const acknowledged = { ...reservation, transactionHash: hex32('33') };
    await writeInfrastructureJournal(1, acknowledged);
    await expect(readInfrastructureJournal(1)).resolves.toEqual(acknowledged);
  });

  it('refuses to overwrite a different unresolved attempt', async () => {
    await writeInfrastructureJournal(1, reservation);
    await expect(writeInfrastructureJournal(1, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
    await expect(readInfrastructureJournal(1)).resolves.toEqual(reservation);
  });

  it('does not let a stale completion erase a newer attempt', async () => {
    await writeInfrastructureJournal(1, reservation);
    await clearInfrastructureJournal(1, reservation);
    await writeInfrastructureJournal(1, newer);
    await clearInfrastructureJournal(1, reservation);
    await expect(readInfrastructureJournal(1)).resolves.toEqual(newer);
    await clearInfrastructureJournal(1, newer);
    await expect(readInfrastructureJournal(1)).resolves.toBeUndefined();
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
        if (key.endsWith('.1')) {
          started();
          await firstWrite;
        }
        persisted.set(key, JSON.parse(JSON.stringify(value)));
      });
    const chainOne = writeInfrastructureJournal(1, reservation);
    await firstWriteStarted;
    await writeInfrastructureJournal(2, newer);
    await expect(readInfrastructureJournal(2)).resolves.toEqual(newer);
    release();
    await chainOne;
    await expect(readInfrastructureJournal(1)).resolves.toEqual(reservation);
  });

  it.each(['read', 'write', 'clear'])(
    'fails closed when the storage read for %s rejects',
    async (operation) => {
      await writeInfrastructureJournal(1, reservation);
      const writesBefore = jest.mocked(chromeStorage.setItem).mock.calls.length;
      jest
        .mocked(chromeStorage.getItem)
        .mockRejectedValueOnce(new Error('Storage read failed'));
      const result =
        operation === 'read'
          ? readInfrastructureJournal(1)
          : operation === 'write'
          ? writeInfrastructureJournal(1, newer)
          : clearInfrastructureJournal(1, reservation);
      await expect(result).rejects.toThrow('Storage read failed');
      expect(chromeStorage.setItem).toHaveBeenCalledTimes(writesBefore);
      await expect(readInfrastructureJournal(1)).resolves.toEqual(reservation);
    }
  );

  it('reports failed writes and releases the chain mutex for a later retry', async () => {
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage write failed'));
    await expect(writeInfrastructureJournal(1, reservation)).rejects.toThrow(
      'Storage write failed'
    );
    await expect(readInfrastructureJournal(1)).resolves.toBeUndefined();
    await writeInfrastructureJournal(1, reservation);
    await expect(readInfrastructureJournal(1)).resolves.toEqual(reservation);
  });

  it('retains pending state when clearing storage fails', async () => {
    await writeInfrastructureJournal(1, reservation);
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage clear failed'));
    await expect(clearInfrastructureJournal(1, reservation)).rejects.toThrow(
      'Storage clear failed'
    );
    await expect(readInfrastructureJournal(1)).resolves.toEqual(reservation);
    await expect(writeInfrastructureJournal(1, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
  });
});
