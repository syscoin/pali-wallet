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

const assertCurrent = () => undefined;
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
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
    const acknowledged = { ...reservation, transactionHash: hex32('33') };
    await writeInfrastructureJournal(network, acknowledged);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(acknowledged);
  });

  it('refuses to overwrite a different unresolved attempt', async () => {
    await writeInfrastructureJournal(network, reservation);
    await expect(writeInfrastructureJournal(network, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
  });

  it('retains the exact pending attempt when its observation retires inside the journal lock', async () => {
    await writeInfrastructureJournal(network, reservation);
    let entered!: () => void;
    let release!: (entry: InfrastructureJournalEntry) => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<InfrastructureJournalEntry>((resolve) => {
      release = resolve;
    });
    jest
      .mocked(chromeStorage.getItem)
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(() => {
        entered();
        return held;
      });
    let current = true;
    const clearing = clearInfrastructureJournal(network, reservation, () => {
      if (!current) throw new Error('Observation retired');
    });
    const rejected = expect(clearing).rejects.toThrow('Observation retired');
    await started;
    current = false;
    release(reservation);
    await rejected;
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
    expect(persisted.get(infrastructureJournalStorageKey(network))).toEqual(
      reservation
    );
  });

  it('shares one chain reservation across RPC aliases but permits only the owning RPC to update or clear it', async () => {
    const otherReservation = { ...newer, rpcUrl: otherFork.url };
    await writeInfrastructureJournal(network, reservation);
    await expect(
      readInfrastructureJournal(otherFork, assertCurrent)
    ).resolves.toEqual(reservation);
    await expect(
      writeInfrastructureJournal(otherFork, otherReservation)
    ).rejects.toThrow('Another infrastructure deployment is pending');
    await clearInfrastructureJournal(otherFork, reservation, null);
    await clearInfrastructureJournal(
      otherFork,
      {
        ...reservation,
        rpcUrl: otherFork.url,
      },
      null
    );
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
    await clearInfrastructureJournal(network, reservation, null);
    await writeInfrastructureJournal(otherFork, otherReservation);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(otherReservation);
  });

  it('serializes same-chain RPC reservation writes before the first storage write settles', async () => {
    let release!: () => void;
    let started!: () => void;
    const firstWriteStarted = new Promise<void>(
      (resolve) => (started = resolve)
    );
    const firstWrite = new Promise<void>((resolve) => (release = resolve));
    jest
      .mocked(chromeStorage.setItem)
      .mockImplementationOnce(async (key, value) => {
        started();
        await firstWrite;
        persisted.set(key, value);
      });
    const first = writeInfrastructureJournal(network, reservation);
    await firstWriteStarted;
    const second = writeInfrastructureJournal(otherFork, {
      ...newer,
      rpcUrl: otherFork.url,
    });
    const rejected = expect(second).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
    release();
    await first;
    await rejected;
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
    await expect(
      readInfrastructureJournal(otherFork, assertCurrent)
    ).resolves.toEqual(reservation);
  });

  it('retains legacy chain-only entries without inferring or rewriting their RPC', async () => {
    const legacy = { ...reservation };
    delete legacy.rpcUrl;
    persisted.set('pali.infrastructure.pending.v1.1', legacy);
    for (const context of [network, otherFork]) {
      await expect(
        readInfrastructureJournal(context, assertCurrent)
      ).resolves.toEqual(legacy);
      await expect(
        writeInfrastructureJournal(context, {
          ...legacy,
          rpcUrl: context.url,
        })
      ).rejects.toThrow('Another infrastructure deployment is pending');
      await clearInfrastructureJournal(
        context,
        {
          ...legacy,
          rpcUrl: context.url,
        },
        null
      );
    }
    expect(persisted.get('pali.infrastructure.pending.v1.1')).toEqual(legacy);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
  });

  it('keeps legacy precedence and discards a legacy RPC even when a scoped entry also exists', async () => {
    persisted.set('pali.infrastructure.pending.v1.1', reservation);
    persisted.set(infrastructureJournalStorageKey(network), newer);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual({ ...reservation, rpcUrl: undefined });
    await expect(writeInfrastructureJournal(network, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
    await clearInfrastructureJournal(network, reservation, null);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
    expect(persisted.get(infrastructureJournalStorageKey(network))).toEqual(
      newer
    );
  });

  it('does not hide an unreadable legacy attempt behind an otherwise valid scoped entry', async () => {
    persisted.set('pali.infrastructure.pending.v1.1', {
      ...reservation,
      attemptId: 'unreadable',
    });
    persisted.set(infrastructureJournalStorageKey(network), newer);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).rejects.toThrow('Deployment journal is unreadable');
    expect(chromeStorage.getItem).toHaveBeenCalledTimes(1);
    expect(chromeStorage.setItem).not.toHaveBeenCalled();
  });

  it('does not clear another contract sharing an attempt identity', async () => {
    await writeInfrastructureJournal(network, reservation);
    await clearInfrastructureJournal(
      network,
      { ...reservation, contractId: 'factory' },
      null
    );
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
    expect(chromeStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, ''])(
    'fails closed on a scoped journal without a valid owning RPC %s',
    async (rpcUrl) => {
      persisted.set(infrastructureJournalStorageKey(network), {
        ...reservation,
        rpcUrl,
      });
      await expect(
        readInfrastructureJournal(network, assertCurrent)
      ).rejects.toThrow('Deployment journal is unreadable');
      await expect(
        clearInfrastructureJournal(network, reservation, null)
      ).rejects.toThrow('Deployment journal is unreadable');
      expect(chromeStorage.setItem).not.toHaveBeenCalled();
    }
  );

  it('does not let a stale completion erase a newer attempt', async () => {
    await writeInfrastructureJournal(network, reservation);
    await clearInfrastructureJournal(network, reservation, null);
    await writeInfrastructureJournal(network, newer);
    await clearInfrastructureJournal(network, reservation, null);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(newer);
    await clearInfrastructureJournal(network, newer, null);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toBeUndefined();
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
    await expect(
      readInfrastructureJournal(otherChain, assertCurrent)
    ).resolves.toEqual(newer);
    release();
    await chainOne;
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
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
          ? readInfrastructureJournal(network, assertCurrent)
          : operation === 'write'
          ? writeInfrastructureJournal(network, newer)
          : clearInfrastructureJournal(network, reservation, null);
      await expect(result).rejects.toThrow('Storage read failed');
      expect(chromeStorage.setItem).toHaveBeenCalledTimes(writesBefore);
      await expect(
        readInfrastructureJournal(network, assertCurrent)
      ).resolves.toEqual(reservation);
    }
  );

  it('reports failed writes and releases the chain mutex for a later retry', async () => {
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage write failed'));
    await expect(
      writeInfrastructureJournal(network, reservation)
    ).rejects.toThrow('Storage write failed');
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toBeUndefined();
    await writeInfrastructureJournal(network, reservation);
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
  });

  it('retains pending state when clearing storage fails', async () => {
    await writeInfrastructureJournal(network, reservation);
    jest
      .mocked(chromeStorage.setItem)
      .mockRejectedValueOnce(new Error('Storage clear failed'));
    await expect(
      clearInfrastructureJournal(network, reservation, null)
    ).rejects.toThrow('Storage clear failed');
    await expect(
      readInfrastructureJournal(network, assertCurrent)
    ).resolves.toEqual(reservation);
    await expect(writeInfrastructureJournal(network, newer)).rejects.toThrow(
      'Another infrastructure deployment is pending'
    );
  });
});
