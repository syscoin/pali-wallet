import type { DeviceUnlockEnrollmentSnapshot, OpenWalletStorage } from '../storage/types.ts';
import type { DeviceUnlockCredentialScope, createDeviceUnlockCredentialStore } from '../storage/deviceUnlockCredential.ts';

type Guard = () => void;
type Credential = Readonly<{ pairFingerprint: string; key: Uint8Array }>;
type Operation = {
  kind: 'issue' | 'resume' | 'disable';
  check: Guard;
  scope?: DeviceUnlockCredentialScope;
  attempted?: boolean;
  completed?: boolean;
};

const unavailable = () => new Error('DEVICE_UNLOCK_UNAVAILABLE');
const checked = (guard: Guard) => {
  const result: unknown = guard();
  if (result === undefined) return;
  void Promise.resolve(result).catch(() => undefined);
  throw unavailable();
};
const scopeOf = (snapshot: DeviceUnlockEnrollmentSnapshot, enrollmentId: string): DeviceUnlockCredentialScope =>
  Object.freeze({ ...snapshot, enrollmentId });
const same = (next: DeviceUnlockEnrollmentSnapshot | null, scope: DeviceUnlockCredentialScope) =>
  !!next && next.installationId === scope.installationId && next.walletBindingId === scope.walletBindingId &&
  next.pairFingerprint === scope.pairFingerprint && next.enrollmentId === scope.enrollmentId;

/** Private host bridge. The SDK owns password verification and the derived key. */
export function createDeviceUnlockEnrollment(ports: Readonly<{
  enrollment: NonNullable<OpenWalletStorage['deviceUnlockEnrollment']>;
  credentials: ReturnType<typeof createDeviceUnlockCredentialStore>;
  randomId(): string;
}>) {
  let active: Operation | undefined;
  const run = async <T>(kind: Operation['kind'], guard: Guard, action: (operation: Operation) => Promise<T>): Promise<T> => {
    if (active) throw unavailable();
    const operation: Operation = { kind, check() {
      if (active !== operation) throw unavailable();
      checked(guard);
      if (active !== operation) throw unavailable();
    } };
    active = operation;
    try { operation.check(); return await action(operation); }
    finally { if (active === operation) active = undefined; }
  };
  // Only a just-staged alias or an acknowledged, already-revoked alias is cleaned up here.
  const discard = async (scope: DeviceUnlockCredentialScope) => {
    try { await ports.credentials.remove(scope, () => undefined); } catch { /* An inactive alias cannot grant unlock. */ }
  };
  const sdkPort = Object.freeze({
    async writeCredential(credential: Credential, sdkGuard: Guard): Promise<void> {
      const operation = active, scope = operation?.scope;
      if (!operation || operation.kind !== 'issue' || !scope || operation.attempted || credential.pairFingerprint !== scope.pairFingerprint)
        throw unavailable();
      checked(sdkGuard);
      operation.check();
      operation.attempted = true;
      await ports.credentials.stage(scope, credential.key, () => {
        operation.check(); checked(sdkGuard); operation.check();
      });
      operation.check();
      operation.completed = true;
    },
    async readCredential(pairFingerprint: string): Promise<Credential | null> {
      const operation = active, scope = operation?.scope;
      if (!operation || operation.kind !== 'resume' || !scope || operation.attempted || pairFingerprint !== scope.pairFingerprint)
        return null;
      operation.attempted = true;
      const key = await ports.credentials.read(scope, operation.check);
      if (!key) return null;
      try {
        const reference = await ports.enrollment.read();
        operation.check();
        if (!same(reference, scope)) throw unavailable();
        operation.completed = true;
        return Object.freeze({ pairFingerprint, key });
      } catch (error) { key.fill(0); throw error; }
    },
  });
  return Object.freeze({
    sdkPort,
    issue: (prove: (assertCurrent: Guard) => Promise<boolean>, guard: Guard) => run('issue', guard, async (operation) => {
      const { check } = operation;
      if (!await ports.credentials.available()) throw unavailable();
      check();
      const previous = await ports.enrollment.read();
      check();
      if (!previous) throw unavailable();
      const id = ports.randomId();
      if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || id === previous.enrollmentId) throw unavailable();
      const scope = scopeOf(previous, id);
      operation.scope = scope;
      let discardStaged = true;
      try {
        const proved = await prove(check);
        check();
        if (proved === false) return false;
        if (proved !== true || !operation.completed) throw unavailable();
        // A rejected call can follow a durable COMMIT. Keep the staged item
        // until a coherent reopen can determine whether it is referenced.
        discardStaged = false;
        if (!await ports.enrollment.compareAndSet(previous, id, check)) {
          discardStaged = true;
          throw unavailable();
        }
        check();
      } finally {
        if (discardStaged && operation.attempted) await discard(scope);
      }
      if (previous.enrollmentId) await discard(scopeOf(previous, previous.enrollmentId));
      check();
      return true;
    }),
    // The host keeps the captured SDK instance reserved through settlement.
    // Its retirement callback must lock that instance even if the UI is stale.
    resume: (prove: (assertCurrent: Guard) => Promise<boolean>, guard: Guard, retire: () => Promise<void>) => run('resume', guard, async (operation) => {
      const reference = await ports.enrollment.read();
      operation.check();
      if (!reference?.enrollmentId) return false;
      const scope = scopeOf(reference, reference.enrollmentId);
      operation.scope = scope;
      let confirmed = false;
      try {
        const accepted = await prove(operation.check);
        operation.check();
        if (accepted !== true || !operation.completed) return false;
        const latest = await ports.enrollment.read();
        operation.check();
        if (!same(latest, scope)) throw unavailable();
        confirmed = true;
        return true;
      } finally { if (!confirmed) await retire(); }
    }),
    /** Caller must authenticate the current wallet password before entering this mutation. */
    disable: (guard: Guard) => run('disable', guard, async ({ check }) => {
      const reference = await ports.enrollment.read();
      check();
      if (!reference?.enrollmentId) return;
      if (!await ports.enrollment.compareAndSet(reference, null, check)) throw unavailable();
      await discard(scopeOf(reference, reference.enrollmentId));
      check();
    }),
  });
}
