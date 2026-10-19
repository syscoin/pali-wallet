import { walletPersistenceGate } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';

import { withSentryPersistence } from './persistence';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

afterEach(() => {
  walletPersistenceGate.blocked = false;
});

it('refuses a queued old-wallet write without deleting a newer wallet record', async () => {
  const held = deferred();
  const blocker = walletPersistenceMutex.runExclusive(() => held.promise);
  let current = true;
  const records = { oldWallet: 'old value', newWallet: 'new value' };
  const write = jest.fn(async () => {
    records.oldWallet = 'stale edit';
  });
  const saving = withSentryPersistence(() => {
    if (!current) throw new Error('Wallet changed');
  }, write);
  const rejected = expect(saving).rejects.toThrow('Wallet changed');
  current = false;
  held.resolve();
  await blocker;
  await rejected;
  expect(write).not.toHaveBeenCalled();
  expect(records).toEqual({ oldWallet: 'old value', newWallet: 'new value' });
});

it('does not dispatch a write while recovery owns the stored wallet', async () => {
  walletPersistenceGate.blocked = true;
  const write = jest.fn(async () => undefined);
  await expect(withSentryPersistence(() => undefined, write)).rejects.toThrow(
    'Wallet recovery'
  );
  expect(write).not.toHaveBeenCalled();
});

it('releases the persistence mutex after a failed write', async () => {
  await expect(
    withSentryPersistence(
      () => undefined,
      async () => {
        throw new Error('Storage unavailable');
      }
    )
  ).rejects.toThrow('Storage unavailable');
  await expect(
    withSentryPersistence(
      () => undefined,
      async () => 'saved'
    )
  ).resolves.toBe('saved');
});
