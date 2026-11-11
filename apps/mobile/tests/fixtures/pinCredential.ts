import { captureNativePinRecord, type NativePinCredentialPort } from '../../src/custody/pinVault.ts';

/** Test OS-secret storage. Keep one port for all reopen attempts in a fixture. */
export function createTestPinCredentialPort(): NativePinCredentialPort {
  const values = new Map<string, { header: string; secret: string; publicKey: number[]; pepper: number[] }>();
  return {
    async readPublic(input, check) {
      check(); const record = captureNativePinRecord(input), value = values.get(`${record.installationId}:${record.enrollmentId}`);
      if (!value) return null;
      if (value.header !== JSON.stringify(record)) throw Error('PIN_UNAVAILABLE');
      check(); return { publicKey: Uint8Array.from(value.publicKey), pepper: Uint8Array.from(value.pepper) };
    },
    async readSecret(input, check) {
      check(); const record = captureNativePinRecord(input), value = values.get(`${record.installationId}:${record.enrollmentId}`);
      if (!value) return null;
      if (value.header !== JSON.stringify(record)) throw Error('PIN_UNAVAILABLE');
      check(); return value.secret;
    },
    async stage(input, value, check) {
      check(); const record = captureNativePinRecord(input);
      values.set(`${record.installationId}:${record.enrollmentId}`, { header: JSON.stringify(record), secret: value.secret, publicKey: [...value.publicKey], pepper: [...value.pepper] }); check();
    },
    async remove(record) { values.delete(`${record.installationId}:${record.enrollmentId}`); },
  };
}
