import {
  captureEvmSubmission,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring';

import {
  EvmSignedRecords,
  inspectEvmSignedBundle,
  EVM_SIGNED_RECORD_PREFIX,
} from '../../../wallet/evmSignedRecords';
import { assertWalletPersistenceAllowed } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import type { EvmSignedRecordStorage } from '../../../wallet/evmSignedRecords';

/** One background-owned writer, sharing the wallet's existing persistence barrier. */
export function createChromeEvmSignedRecordStorage(): EvmSignedRecordStorage {
  let unavailable = false;
  const check = () => {
    assertWalletPersistenceAllowed();
    if (unavailable) throw new Error('EVM_SIGNED_RECORD_REOPEN_REQUIRED');
  };
  const key = (profileId: string) => {
    if (!/^0x[0-9a-f]{64}$/.test(profileId))
      throw new Error('EVM_SIGNED_RECORD_CORRUPT');
    return EVM_SIGNED_RECORD_PREFIX + profileId;
  };
  const read = async (profileId: string): Promise<string | undefined> => {
    check();
    const name = key(profileId);
    const rows = await chromeStorage.getItems([name]);
    check();
    const value = rows[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new Error('EVM_SIGNED_RECORD_CORRUPT');
    inspectEvmSignedBundle(value, profileId);
    return value;
  };
  return Object.freeze({
    read,
    compareAndSet: (profileId, expected, next, assertCurrent) =>
      walletPersistenceMutex.runExclusive(async () => {
        check();
        assertCurrent();
        inspectEvmSignedBundle(next, profileId);
        const before = await read(profileId);
        assertCurrent();
        if (before !== expected) return false;
        try {
          await chromeStorage.setItem(key(profileId), next);
          const after = await read(profileId);
          if (after !== next)
            throw new Error('EVM signed-record readback differs');
        } catch {
          unavailable = true;
          throw new Error('EVM_SIGNED_RECORD_REOPEN_REQUIRED');
        }
        // A late revocation discards the operation result, never the committed record.
        assertCurrent();
        return true;
      }),
  });
}

export function createChromeEvmSignedRecords(): EvmSignedRecords {
  return new EvmSignedRecords(createChromeEvmSignedRecordStorage());
}

/** An older SDK must never silently ignore the host persistence injection. */
export function assertEvmSignedRecordSdk(): void {
  if (
    typeof captureEvmSubmission !== 'function' ||
    typeof submitSignedEvmTransaction !== 'function'
  )
    throw new Error('Shared EVM submission SDK is required');
}
