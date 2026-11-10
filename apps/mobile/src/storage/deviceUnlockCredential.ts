import { isDeviceUnlockUserRefusal, type DeviceUnlockCredentialScope } from '../../../../source/wallet/deviceUnlockEnrollment.ts';

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
  try { return await operation(); } catch (error) {
    if (isDeviceUnlockUserRefusal(error)) throw error;
    throw unavailable();
  }
}

/** Match only Expo's explicit native user-cancel taxonomy, never a storage error. */
export function isNativeDeviceUnlockRefusal(platform: string, error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const fields = Object.getOwnPropertyDescriptors(error);
  const code = fields.code && 'value' in fields.code ? fields.code.value : null;
  const message = fields.message && 'value' in fields.message ? fields.message.value : null;
  if (platform === 'ios') return code === 'ERR_KEY_CHAIN' && (message === 'User canceled the operation.' ||
    message === 'Authentication failed. Provided passphrase/PIN is incorrect or there is no user authentication method configured for this device.');
  return platform === 'android' && code === 'ERR_AUTHENTICATION' && typeof message === 'string' && [
    'User canceled the authentication', 'Hardware not present', 'Hardware unavailable',
    'No biometrics enrolled', 'No device credential', 'Lockout', 'Lockout permanent', 'Timeout', 'Unable to process',
  ].some(reason => message.startsWith(`Could not authenticate the user: ${reason}. `));
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
