import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software';
import { webcrypto } from 'crypto';

import { EvmSignedRecords } from '../../source/wallet/evmSignedRecords';

import type { EvmSignedRecordSession } from '../../source/wallet/evmSignedRecords';

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  })
);
afterAll(() => {
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});

/** Actual SDK AEAD + repository-issued receipts; only the atomic storage edge is local. */
export function createSmartAccountJournalFixture() {
  const keyring: any = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () =>
    'synthetic smart controller journal root';
  let stored: string | undefined;
  const records = new EvmSignedRecords({
    read: async () => stored,
    compareAndSet: async (_profile, expected, next, guard) => {
      guard();
      if (stored !== expected) return false;
      stored = next;
      return true;
    },
  });
  const session = (assertCurrent: () => void): EvmSignedRecordSession => ({
    keyring,
    assertCurrent,
  });
  return {
    captureSmartAccountPendingRecords(
      chainId: number,
      address: string,
      assertCurrent: () => void
    ) {
      return records.captureSmartAccountPendingRecords(
        session(assertCurrent),
        String(chainId),
        address
      );
    },
    retainSmartAccountAuthorization(
      input: Parameters<EvmSignedRecords['retainSmartAccountAuthorization']>[1],
      assertCurrent: () => void
    ) {
      return records.retainSmartAccountAuthorization(
        session(assertCurrent),
        input
      );
    },
    records,
    session,
    stored: () => stored,
  };
}
