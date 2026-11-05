import {
  captureEvmSubmission,
  submitSignedEvmTransaction,
} from '@sidhujag/sysweb3-keyring';

import {
  EvmSignedRecords,
  inspectEvmSignedBundle,
  EVM_SIGNED_RECORD_PREFIX,
} from '../../../wallet/evmSignedRecords';
import {
  inspectUtxoSignedBundle,
  UTXO_SIGNED_RECORD_PREFIX,
  UtxoSignedRecords,
} from '../../../wallet/utxoSignedRecords';
import { assertWalletPersistenceAllowed } from 'state/paliStorage';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import type { EvmSignedRecordStorage } from '../../../wallet/evmSignedRecords';

/** One background-owned writer, sharing the wallet's existing persistence barrier. */
function createChromeSignedRecordStorage(
  prefix: string,
  family: 'EVM' | 'UTXO',
  inspect: (value: string, profileId: string) => unknown
): EvmSignedRecordStorage {
  let unavailable = false;
  const check = () => {
    assertWalletPersistenceAllowed();
    if (unavailable) throw new Error(`${family}_SIGNED_RECORD_REOPEN_REQUIRED`);
  };
  const key = (profileId: string) => {
    if (!/^0x[0-9a-f]{64}$/.test(profileId))
      throw new Error(`${family}_SIGNED_RECORD_CORRUPT`);
    return prefix + profileId;
  };
  const readRaw = async (profileId: string): Promise<string | undefined> => {
    check();
    const name = key(profileId);
    const rows = await chromeStorage.getItems([name]);
    check();
    const value = rows[name];
    if (value === undefined) return undefined;
    if (typeof value !== 'string')
      throw new Error(`${family}_SIGNED_RECORD_CORRUPT`);
    return value;
  };
  const read = async (profileId: string): Promise<string | undefined> => {
    const value = await readRaw(profileId);
    // UTXO reads are private to the authenticated journal, which parses once.
    if (value !== undefined && family === 'EVM') inspect(value, profileId);
    return value;
  };
  return Object.freeze({
    read,
    compareAndSet: (profileId, expected, next, assertCurrent) =>
      walletPersistenceMutex.runExclusive(async () => {
        check();
        assertCurrent();
        inspect(next, profileId);
        const before = await readRaw(profileId);
        assertCurrent();
        if (before !== expected) return false;
        try {
          await chromeStorage.setItem(key(profileId), next);
          const after = await readRaw(profileId);
          if (after !== next) throw new Error('Signed-record readback differs');
        } catch {
          unavailable = true;
          throw new Error(`${family}_SIGNED_RECORD_REOPEN_REQUIRED`);
        }
        // A late revocation discards the operation result, never the committed record.
        assertCurrent();
        return true;
      }),
  });
}

export function createChromeEvmSignedRecordStorage(): EvmSignedRecordStorage {
  return createChromeSignedRecordStorage(
    EVM_SIGNED_RECORD_PREFIX,
    'EVM',
    inspectEvmSignedBundle
  );
}

export function createChromeEvmSignedRecords(): EvmSignedRecords {
  return new EvmSignedRecords(createChromeEvmSignedRecordStorage());
}

export function createChromeUtxoSignedRecords(
  admissionOwner: object,
  onUnavailable: () => void
): UtxoSignedRecords {
  return new UtxoSignedRecords(
    createChromeSignedRecordStorage(
      UTXO_SIGNED_RECORD_PREFIX,
      'UTXO',
      inspectUtxoSignedBundle
    ),
    admissionOwner,
    onUnavailable
  );
}

/** An older SDK must never silently ignore the host persistence injection. */
export function assertEvmSignedRecordSdk(): void {
  if (
    typeof captureEvmSubmission !== 'function' ||
    typeof submitSignedEvmTransaction !== 'function'
  )
    throw new Error('Shared EVM submission SDK is required');
}
