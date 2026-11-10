import type {
  DeviceUnlockCredentialScope,
  DeviceUnlockEnrollmentPort,
  DeviceUnlockEnrollmentSnapshot,
} from './deviceUnlockEnrollment';
import {
  captureLocalPasskeyRecord,
  captureLocalPasskeyScope,
  type LocalPasskeyRecord,
  type LocalPasskeyStorage,
} from './localPasskeyCredential';
import {
  checkLocalPasskeyOwner,
  localPasskeyError,
  localPasskeyField,
  localPasskeyFields,
  localPasskeyOrigin,
} from './localPasskeyTypes';

export const LOCAL_PASSKEY_STORAGE_KEY = 'pali-local-passkey-v1';
type WalletRecord = Readonly<{
  enrollmentId: string | null;
  pairFingerprint: string;
  records: Readonly<Record<string, LocalPasskeyRecord>>;
  walletBindingId: string;
}>;
type Stored = Readonly<{
  installationId: string;
  version: 1;
  wallet: WalletRecord | null;
}>;
type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const nullableId = (value: unknown): string | null => {
  if (value === null) return null;
  if (id(value)) return value;
  throw localPasskeyError();
};
const fingerprint = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Public enrollment metadata and encrypted wrappers only; no vault key crosses this port. */
export function createBrowserLocalPasskeyStorage(
  ports: Readonly<{
    assertCurrent(): void;
    origin: string;
    randomId(): string;
    readVaultPair(): Promise<Readonly<{ pairFingerprint: string }> | null>;
    runExclusive<T>(work: () => Promise<T>): Promise<T>;
    storage: Storage;
  }>
): Readonly<{
  credentials: LocalPasskeyStorage;
  enrollment: DeviceUnlockEnrollmentPort;
  invalidate(assertCurrent: () => void): Promise<void>;
}> {
  const origin = localPasskeyOrigin(ports.origin);
  if (
    [
      ports.storage?.get,
      ports.storage?.set,
      ports.runExclusive,
      ports.readVaultPair,
      ports.randomId,
      ports.assertCurrent,
    ].some((value) => typeof value !== 'function')
  )
    throw localPasskeyError();
  const captureExpected = (
    input: DeviceUnlockEnrollmentSnapshot
  ): DeviceUnlockEnrollmentSnapshot => {
    localPasskeyFields(input, [
      'installationId',
      'walletBindingId',
      'pairFingerprint',
      'enrollmentId',
    ]);
    const installationId = localPasskeyField(input, 'installationId');
    const walletBindingId = localPasskeyField(input, 'walletBindingId');
    const pairFingerprint = localPasskeyField(input, 'pairFingerprint');
    const enrollmentId = nullableId(localPasskeyField(input, 'enrollmentId'));
    if (
      !id(installationId) ||
      !id(walletBindingId) ||
      !fingerprint(pairFingerprint)
    )
      throw localPasskeyError();
    return Object.freeze({
      installationId,
      walletBindingId,
      pairFingerprint,
      enrollmentId,
    });
  };

  let unavailable = false;
  const check = (guard?: () => void) => {
    if (unavailable) throw localPasskeyError();
    checkLocalPasskeyOwner(ports.assertCurrent);
    if (guard) checkLocalPasskeyOwner(guard);
    if (unavailable) throw localPasskeyError();
  };
  const randomId = () => {
    const result = ports.randomId();
    if (!id(result)) throw localPasskeyError();
    return result;
  };
  const capture = (value: unknown): Stored | undefined => {
    if (value === undefined) return undefined;
    localPasskeyFields(value, ['version', 'installationId', 'wallet']);
    const installationId = localPasskeyField(value, 'installationId');
    const wallet = localPasskeyField(value, 'wallet');
    if (localPasskeyField(value, 'version') !== 1 || !id(installationId))
      throw localPasskeyError();
    if (wallet === null)
      return Object.freeze({ version: 1, installationId, wallet: null });
    localPasskeyFields(wallet, [
      'walletBindingId',
      'pairFingerprint',
      'enrollmentId',
      'records',
    ]);
    const walletBindingId = localPasskeyField(wallet, 'walletBindingId');
    const pairFingerprint = localPasskeyField(wallet, 'pairFingerprint');
    const enrollmentId = nullableId(localPasskeyField(wallet, 'enrollmentId'));
    const records = localPasskeyField(wallet, 'records');
    if (
      !id(walletBindingId) ||
      !fingerprint(pairFingerprint) ||
      !records ||
      typeof records !== 'object' ||
      Array.isArray(records) ||
      Reflect.ownKeys(records).length > 2
    )
      throw localPasskeyError();
    const captured: Record<string, LocalPasskeyRecord> = {};
    for (const key of Reflect.ownKeys(records)) {
      if (!id(key)) throw localPasskeyError();
      const scope = {
        installationId,
        walletBindingId,
        pairFingerprint,
        enrollmentId: key,
      };
      captured[key] = captureLocalPasskeyRecord(
        localPasskeyField(records, key),
        scope,
        origin
      );
    }
    if (enrollmentId !== null && !Object.hasOwn(captured, enrollmentId))
      throw localPasskeyError();
    return Object.freeze({
      version: 1,
      installationId,
      wallet: Object.freeze({
        walletBindingId,
        pairFingerprint,
        enrollmentId,
        records: Object.freeze(captured),
      }),
    });
  };
  const readStored = async (guard?: () => void) => {
    check(guard);
    const values = await ports.storage.get([LOCAL_PASSKEY_STORAGE_KEY]);
    check(guard);
    return capture(localPasskeyField(values, LOCAL_PASSKEY_STORAGE_KEY));
  };
  const readPair = async (guard?: () => void) => {
    check(guard);
    const pair = await ports.readVaultPair();
    check(guard);
    if (pair === null) return null;
    const value = localPasskeyField(pair, 'pairFingerprint');
    if (!fingerprint(value)) throw localPasskeyError();
    return value;
  };
  const write = async (
    before: Stored | undefined,
    next: Stored,
    pair: string | null,
    guard?: () => void
  ) => {
    check(guard);
    if (
      !same(await readStored(guard), before) ||
      (await readPair(guard)) !== pair
    )
      throw localPasskeyError();
    check(guard);
    try {
      await ports.storage.set({ [LOCAL_PASSKEY_STORAGE_KEY]: next });
      check(guard);
      if (
        !same(await readStored(guard), next) ||
        (await readPair(guard)) !== pair
      )
        throw localPasskeyError();
      check(guard);
    } catch (error) {
      // Never compensate an ambiguous storage acknowledgement by deleting data.
      // A new owner must reread the coherent durable state before another write.
      unavailable = true;
      throw error;
    }
  };
  const current = async (guard?: () => void): Promise<Stored> => {
    const before = await readStored(guard),
      pair = await readPair(guard);
    if (
      before &&
      (pair === null
        ? before.wallet === null
        : before.wallet?.pairFingerprint === pair)
    )
      return before;
    const next: Stored = Object.freeze({
      version: 1,
      installationId: before?.installationId ?? randomId(),
      wallet:
        pair === null
          ? null
          : Object.freeze({
              walletBindingId: randomId(),
              pairFingerprint: pair,
              enrollmentId: null,
              records: Object.freeze({}),
            }),
    });
    await write(before, next, pair, guard);
    return next;
  };
  const snapshot = (value: Stored): DeviceUnlockEnrollmentSnapshot | null =>
    value.wallet
      ? Object.freeze({
          installationId: value.installationId,
          walletBindingId: value.wallet.walletBindingId,
          pairFingerprint: value.wallet.pairFingerprint,
          enrollmentId: value.wallet.enrollmentId,
        })
      : null;
  const matches = (value: Stored, scope: DeviceUnlockCredentialScope) => {
    const actual = snapshot(value);
    return (
      actual !== null &&
      actual.installationId === scope.installationId &&
      actual.walletBindingId === scope.walletBindingId &&
      actual.pairFingerprint === scope.pairFingerprint
    );
  };
  const run = <T>(
    guard: (() => void) | undefined,
    work: (value: Stored) => Promise<T>
  ) => {
    check(guard);
    return ports.runExclusive(async () => {
      check(guard);
      return work(await current(guard));
    });
  };
  const enrollment: DeviceUnlockEnrollmentPort = Object.freeze({
    read: () => run(undefined, async (value) => snapshot(value)),
    compareAndSet: (input, enrollmentId, guard) => {
      const expected = captureExpected(input);
      return run(guard, async (value) => {
        if (!same(snapshot(value), expected)) return false;
        if (
          !value.wallet ||
          (enrollmentId !== null &&
            (!id(enrollmentId) ||
              !Object.hasOwn(value.wallet.records, enrollmentId)))
        )
          throw localPasskeyError();
        const next = capture({
          ...value,
          wallet: { ...value.wallet, enrollmentId },
        })!;
        await write(value, next, value.wallet.pairFingerprint, guard);
        return true;
      });
    },
  });
  const credentials: LocalPasskeyStorage = Object.freeze({
    read: (input) => {
      const scope = captureLocalPasskeyScope(input);
      return run(undefined, async (value) =>
        matches(value, scope)
          ? value.wallet!.records[scope.enrollmentId]
          : undefined
      );
    },
    stage: (input, record, guard) => {
      const scope = captureLocalPasskeyScope(input);
      const captured = captureLocalPasskeyRecord(record, scope, origin);
      return run(guard, async (value) => {
        if (
          !matches(value, scope) ||
          !id(scope.enrollmentId) ||
          scope.enrollmentId === value.wallet!.enrollmentId
        )
          throw localPasskeyError();
        const active = value.wallet!.enrollmentId;
        // Keep the active record. Coherent inactive aliases cannot grant unlock.
        const records = {
          ...(active ? { [active]: value.wallet!.records[active] } : {}),
          [scope.enrollmentId]: captured,
        };
        const next = capture({
          ...value,
          wallet: { ...value.wallet, records },
        })!;
        await write(value, next, value.wallet!.pairFingerprint, guard);
      });
    },
    remove: (input, guard) => {
      const scope = captureLocalPasskeyScope(input);
      return run(guard, async (value) => {
        if (
          !matches(value, scope) ||
          !Object.hasOwn(value.wallet!.records, scope.enrollmentId)
        )
          return;
        if (value.wallet!.enrollmentId === scope.enrollmentId)
          throw localPasskeyError();
        const records = { ...value.wallet!.records };
        delete records[scope.enrollmentId];
        const next = capture({
          ...value,
          wallet: { ...value.wallet, records },
        })!;
        await write(value, next, value.wallet!.pairFingerprint, guard);
      });
    },
  });
  return Object.freeze({
    enrollment,
    credentials,
    invalidate: (guard) =>
      run(guard, async (value) => {
        if (value.wallet === null) return;
        await write(
          value,
          Object.freeze({ ...value, wallet: null }),
          value.wallet.pairFingerprint,
          guard
        );
      }),
  });
}
