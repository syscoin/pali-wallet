export type DeviceUnlockCredentialScope = Readonly<{
  installationId: string;
  walletBindingId: string;
  pairFingerprint: string;
  enrollmentId: string;
}>;

type ProtectedItemPort = Readonly<{
  available(): Promise<boolean>;
  read(name: string): Promise<string | null>;
  write(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
}>;

const unavailable = () => new Error('DEVICE_UNLOCK_UNAVAILABLE');
const id = /^[0-9a-f]{32}$/;
const digest = /^[0-9a-f]{64}$/;

function item(scope: DeviceUnlockCredentialScope) {
  const { installationId, walletBindingId, pairFingerprint, enrollmentId } = scope;
  if (typeof installationId !== 'string' || !id.test(installationId) ||
      typeof walletBindingId !== 'string' || !digest.test(walletBindingId) ||
      typeof pairFingerprint !== 'string' || !digest.test(pairFingerprint) ||
      typeof enrollmentId !== 'string' || !id.test(enrollmentId)) throw unavailable();
  return { name: `enrollment-${enrollmentId}`, header: `pali-device-unlock-v1.${installationId}.${walletBindingId}.${pairFingerprint}.${enrollmentId}.` };
}

function check(assertCurrent: () => void) {
  const result: unknown = assertCurrent();
  if (result === undefined) return;
  void Promise.resolve(result).catch(() => undefined);
  throw unavailable();
}

async function native<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch { throw unavailable(); }
}

/** Trusted custody only. The caller owns the fresh enrollment ID and publishes its pointer separately. */
export function createDeviceUnlockCredentialStore(port: ProtectedItemPort) {
  return Object.freeze({
    async available() { try { return await port.available() === true; } catch { return false; } },
    async read(scope: DeviceUnlockCredentialScope, assertCurrent: () => void): Promise<Uint8Array | null> {
      check(assertCurrent);
      const { name, header } = item(scope);
      const raw = await native(() => port.read(name));
      check(assertCurrent);
      if (raw === null) return null;
      if (typeof raw !== 'string' || raw.length !== header.length + 64 || !raw.startsWith(header)) throw unavailable();
      const keyHex = raw.slice(header.length);
      if (!digest.test(keyHex)) throw unavailable();
      const key = new Uint8Array(32);
      for (let i = 0; i < key.length; i++) key[i] = Number.parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
      return key;
    },
    async stage(scope: DeviceUnlockCredentialScope, key: Uint8Array, assertCurrent: () => void): Promise<void> {
      check(assertCurrent);
      const { name, header } = item(scope);
      if (!(key instanceof Uint8Array) || key.length !== 32) throw unavailable();
      const raw = header + Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('');
      await native(() => port.write(name, raw));
      check(assertCurrent);
      // On iOS a new protected item can be created without an authentication prompt.
      // Confirm a protected read before the host can publish the enrollment.
      const saved = await native(() => port.read(name));
      check(assertCurrent);
      if (saved !== raw) throw unavailable();
    },
    async remove(scope: DeviceUnlockCredentialScope, assertCurrent: () => void): Promise<void> {
      check(assertCurrent);
      const { name } = item(scope);
      await native(() => port.remove(name));
      check(assertCurrent);
    },
  });
}
