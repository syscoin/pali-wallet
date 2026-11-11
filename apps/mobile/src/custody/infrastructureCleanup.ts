import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { nativePublicSessionManifest, captureNativePublicSessionRecord, NATIVE_PUBLIC_SESSION_KEY, type NativePublicSessionRecord } from './publicSession.ts';
import { WALLET_CATALOGUE_KEY, recoveryVerificationRecords, type NativeAccountRecord, type NativeInfrastructurePending } from './walletCatalogue.ts';
import { encodeStorageValue, decodeStorageValue } from '../storage/json.ts';
import type { KeyringStoragePort, WalletIdentityRead } from '../storage/types.ts';

/** Capture authenticated public metadata only, before its wallet session retires. */
export function captureInfrastructureCleanupStorage(storage: KeyringStoragePort,
  readIdentity: () => Promise<WalletIdentityRead | null>,
  owner: { identity: WalletIdentityRead; checkpoint: NativePublicSessionRecord; records: NativeAccountRecord }) {
  const identity = decodeStorageValue(encodeStorageValue(owner.identity)) as WalletIdentityRead;
  const checkpoint = captureNativePublicSessionRecord(owner.checkpoint);
  const identityText = encodeStorageValue(identity), checkpointText = encodeStorageValue(checkpoint);
  const manifest = nativePublicSessionManifest(owner.records, identity, checkpoint.slhStates);
  const fail = (): never => { throw Error('Infrastructure cleanup owner changed'); };
  return (expectedRecord: NativeAccountRecord, pending: NativeInfrastructurePending, guard: () => void): KeyringStoragePort => {
    const expected = recoveryVerificationRecords(expectedRecord, identity.walletBindingId);
    const pendingText = encodeStorageValue(pending);
    const retained = expected.infrastructurePending?.find(value => encodeStorageValue(value) === pendingText);
    if (!retained) fail();
    const expectedText = encodeStorageValue(expected);
    const nextText = encodeStorageValue(recoveryVerificationRecords({ ...expected, revision: expected.revision + 1,
      infrastructurePending: expected.infrastructurePending!.filter(value => value !== retained) }, identity.walletBindingId));
    const unchangedManifest = (record: NativeAccountRecord) => {
      const actual = nativePublicSessionManifest(record, identity, checkpoint.slhStates);
      try { if (actual.length !== manifest.length || actual.some((byte, index) => byte !== manifest[index])) fail(); }
      finally { actual.fill(0); }
    };
    const own = () => assertSynchronousEvmFeeGuard(guard);
    return Object.freeze<KeyringStoragePort>({
      async get(key) { own(); if (key !== WALLET_CATALOGUE_KEY) fail(); const value = await storage.get(key); own(); return value; },
      async set() { fail(); }, async deleteItem() { fail(); }, async createManyIfAbsent() { return fail(); },
      async compareAndSetMany() { return fail(); },
      async compareAndSet(key, before, after, removals, check) {
        const current = () => { own(); if (!check) fail(); assertSynchronousEvmFeeGuard(check!); own(); };
        current();
        if (key !== WALLET_CATALOGUE_KEY || removals !== undefined) fail();
        const previousRecord = recoveryVerificationRecords(before, identity.walletBindingId);
        const nextRecord = recoveryVerificationRecords(after, identity.walletBindingId);
        if (encodeStorageValue(previousRecord) !== expectedText || encodeStorageValue(nextRecord) !== nextText) fail();
        unchangedManifest(previousRecord); unchangedManifest(nextRecord);
        const live = await readIdentity(); current();
        if (encodeStorageValue(live) !== identityText) fail();
        const stored = await storage.get(NATIVE_PUBLIC_SESSION_KEY); current();
        if (encodeStorageValue(stored) !== checkpointText) fail();
        return storage.compareAndSetMany([{ key, expected: before, value: after },
          { key: NATIVE_PUBLIC_SESSION_KEY, expected: stored, value: checkpoint }], current);
      },
    });
  };
}
