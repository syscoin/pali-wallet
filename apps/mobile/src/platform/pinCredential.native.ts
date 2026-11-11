import * as SecureStore from 'expo-secure-store';
import { captureNativePinRecord, type NativePinCredentialPort, type NativePinRecord } from '../custody/pinVault.ts';

const options: SecureStore.SecureStoreOptions = {
  keychainService: 'org.pali.mobile.local-pin.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
const header = (input: NativePinRecord) => { const value = captureNativePinRecord(input); return JSON.stringify(['pali.native.pin-secret.v1', value.installationId, value.walletBindingId, value.pairFingerprint, value.enrollmentId]); };
const name = (value: NativePinRecord) => `pin-${value.installationId}-${value.enrollmentId}`;
const check = (guard: () => void) => { const result: unknown = guard(); if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw new Error('PIN_UNAVAILABLE'); } };
const keyHex = (input: unknown) => {
  if (!(input instanceof Uint8Array)) throw new Error('PIN_UNAVAILABLE');
  const key = new Uint8Array(input);
  try {
    if (key.length !== 32) throw new Error('PIN_UNAVAILABLE');
    return Array.from(key, byte => byte.toString(16).padStart(2, '0')).join('');
  } finally { key.fill(0); }
};
/** Device-only native secret storage; this port is never exposed to presentation. */
export function createNativePinCredentialPort(): NativePinCredentialPort {
  return Object.freeze({
    async readPublic(record, guard) {
      check(guard); const expected = header(record); const raw = await SecureStore.getItemAsync(`${name(record)}.public`, options); check(guard);
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length !== 3 || value[0] !== expected || typeof value[1] !== 'string' || !/^[0-9a-f]{64}$/.test(value[1]) || typeof value[2] !== 'string' || !/^[0-9a-f]{64}$/.test(value[2])) throw new Error('PIN_UNAVAILABLE');
      return { publicKey: Uint8Array.from(value[1].match(/../g)!, byte => Number.parseInt(byte, 16)), pepper: Uint8Array.from(value[2].match(/../g)!, byte => Number.parseInt(byte, 16)) };
    },
    async readSecret(record, guard) {
      check(guard); const expected = header(record); const raw = await SecureStore.getItemAsync(name(record), options); check(guard);
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length !== 2 || value[0] !== expected || typeof value[1] !== 'string' || !/^Pali#1:[0-9a-f]{64}$/.test(value[1])) throw new Error('PIN_UNAVAILABLE');
      return value[1];
    },
    async stage(record, value, guard) {
      check(guard);
      const fields = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(fields).length !== 3 || ['secret', 'publicKey', 'pepper'].some(key => !fields[key] || !('value' in fields[key]!)) ||
          typeof fields.secret!.value !== 'string' || !/^Pali#1:[0-9a-f]{64}$/.test(fields.secret!.value)) throw new Error('PIN_UNAVAILABLE');
      const publicRaw = JSON.stringify([header(record), keyHex(fields.publicKey!.value), keyHex(fields.pepper!.value)]);
      const raw = JSON.stringify([header(record), fields.secret!.value]);
      check(guard);
      await SecureStore.setItemAsync(`${name(record)}.public`, publicRaw, options); check(guard);
      await SecureStore.setItemAsync(name(record), raw, options); check(guard);
      if (await SecureStore.getItemAsync(`${name(record)}.public`, options) !== publicRaw) throw new Error('PIN_UNAVAILABLE'); check(guard);
      if (await SecureStore.getItemAsync(name(record), options) !== raw) throw new Error('PIN_UNAVAILABLE'); check(guard);
    },
    async remove(record) {
      header(record);
      // Keep the private alias first so a failed public cleanup never leaves spending access behind.
      await SecureStore.deleteItemAsync(name(record), options);
      await SecureStore.deleteItemAsync(`${name(record)}.public`, options);
    },
  });
}
