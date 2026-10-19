import { assertWalletPersistenceAllowed } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';

/** Share reset ownership only for the final write, never signing or discovery. */
export const withSentryPersistence = <T>(
  assertCurrent: () => void,
  write: () => Promise<T>
): Promise<T> =>
  walletPersistenceMutex.runExclusive(async () => {
    assertWalletPersistenceAllowed();
    assertCurrent();
    const result = await write();
    assertWalletPersistenceAllowed();
    assertCurrent();
    return result;
  });
