/** Native local authorization. PINs never become SDK vault encryption passwords. */
export type NativePinRecord = Readonly<{
  version: 1; installationId: string; walletBindingId: string; pairFingerprint: string;
  enrollmentId: string; salt: string; verifier: string;
}>;
export type NativePinCredential = Readonly<{ secret: string; pepper: Uint8Array }>;
export type NativePinCredentialPort = Readonly<{
  read(record: NativePinRecord, check: () => void): Promise<NativePinCredential | null>;
  stage(record: NativePinRecord, value: NativePinCredential, check: () => void): Promise<void>;
  remove(record: NativePinRecord): Promise<void>;
}>;
export type NativePinStorage = Readonly<{
  installationId: string;
  read(): Promise<NativePinRecord | null>;
  beginAttempt(record: NativePinRecord, check: () => void): Promise<object>;
  completeAttempt(attempt: object, check: () => void): Promise<void>;
  replace(expected: NativePinRecord, next: NativePinRecord, check: () => void): Promise<void>;
}>;
const unavailable = () => new Error('PIN_UNAVAILABLE');
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export const isNativePin = (value: unknown): value is string => typeof value === 'string' && /^\d{6}$/.test(value);
export function captureNativePinRecord(value: unknown): NativePinRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const own = Object.getOwnPropertyDescriptors(value), names = ['version', 'installationId', 'walletBindingId', 'pairFingerprint', 'enrollmentId', 'salt', 'verifier'];
  if (Reflect.ownKeys(own).length !== names.length || names.some(name => !own[name] || !('value' in own[name]!))) throw unavailable();
  const record = Object.fromEntries(names.map(name => [name, own[name]!.value]));
  if (record.version !== 1 || ['installationId', 'enrollmentId', 'salt'].some(name => typeof record[name] !== 'string' || !/^[0-9a-f]{32}$/.test(record[name])) ||
      ['walletBindingId', 'pairFingerprint'].some(name => typeof record[name] !== 'string' || !/^[0-9a-f]{64}$/.test(record[name])) || typeof record.verifier !== 'string' || !/^[0-9a-f]{128}$/.test(record.verifier)) throw unavailable();
  return Object.freeze(record) as NativePinRecord;
}
function guard(check: () => void) {
  const result: unknown = check();
  if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw unavailable(); }
}
function credential(value: NativePinCredential | null): asserts value is NativePinCredential {
  if (!value || !/^Pali#1:[0-9a-f]{64}$/.test(value.secret) || !(value.pepper instanceof Uint8Array) || value.pepper.length !== 32) throw unavailable();
}
async function verifier(pin: string, record: NativePinRecord, pepper: Uint8Array, check: () => void): Promise<string> {
  if (!isNativePin(pin)) throw unavailable();
  guard(check);
  const input = new TextEncoder().encode(JSON.stringify(['pali.native.pin.v1', record.installationId, record.walletBindingId, record.pairFingerprint, record.enrollmentId, record.salt, pin]));
  const material = new Uint8Array(pepper);
  let output: Uint8Array | undefined;
  try {
    const key = await globalThis.crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    material.fill(0);
    guard(check); output = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, input)); guard(check);
    return hex(output);
  } finally { input.fill(0); material.fill(0); output?.fill(0); }
}
const equal = (left: string, right: string) => { let difference = left.length ^ right.length; for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ (right.charCodeAt(index) || 0); return difference === 0; };

export function createNativePinVault(storage: NativePinStorage, port: NativePinCredentialPort) {
  const random = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));
  const read = async (check: () => void) => {
    guard(check); const record = await storage.read(); guard(check); if (!record) throw unavailable();
    const value = await port.read(record, check);
    try { guard(check); credential(value); return { record, value }; }
    catch (error) { value?.pepper.fill(0); throw error; }
  };
  const withVerifiedSecret = async <T>(pin: string, check: () => void, consume: (secret: string, authenticated: () => Promise<void>) => Promise<T>): Promise<T> => {
    if (!isNativePin(pin)) throw new Error('INVALID_CREDENTIAL');
    guard(check); const record = await storage.read(); guard(check); if (!record) throw unavailable();
    const attempt = await storage.beginAttempt(record, check); guard(check);
    let value: NativePinCredential | null = null, completed = false;
    try {
      value = await port.read(record, check); guard(check); credential(value);
      if (!equal(await verifier(pin, record, value.pepper, check), record.verifier)) throw new Error('INVALID_CREDENTIAL');
      guard(check);
      const result = await consume(value.secret, async () => {
        guard(check); if (completed) throw unavailable();
        await storage.completeAttempt(attempt, check); guard(check); completed = true;
      });
      guard(check); if (!completed) throw unavailable(); return result;
    } finally { if (value?.pepper instanceof Uint8Array) value.pepper.fill(0); }
  };
  return Object.freeze({
    withVerifiedSecret,
    createSecret() { const value = random(32); try { return `Pali#1:${hex(value)}`; } finally { value.fill(0); } },
    async stage(pin: string, scope: Pick<NativePinRecord, 'walletBindingId' | 'pairFingerprint'>, secret: string, check: () => void): Promise<NativePinRecord> {
      if (!isNativePin(pin)) throw unavailable(); guard(check);
      const pepper = random(32), salt = random(16), id = random(16);
      try {
        const base = captureNativePinRecord({ version: 1, installationId: storage.installationId, ...scope, enrollmentId: hex(id), salt: hex(salt), verifier: '0'.repeat(128) });
        const record = captureNativePinRecord({ ...base, verifier: await verifier(pin, base, pepper, check) });
        credential({ secret, pepper }); await port.stage(record, { secret, pepper }, check); guard(check); return record;
      } finally { pepper.fill(0); salt.fill(0); id.fill(0); }
    },
    async authenticate(pin: string, check: () => void, prove: (secret: string) => Promise<boolean>): Promise<boolean> {
      try {
        return await withVerifiedSecret(pin, check, async (secret, authenticated) => {
          if (!(await prove(secret))) throw new Error('INVALID_CREDENTIAL'); guard(check); await authenticated(); return true;
        });
      } catch (error) { if (error instanceof Error && error.message === 'INVALID_CREDENTIAL') return false; throw error; }
    },
    /** Private custody only, after a fresh PIN or protected biometric proof in the same guarded operation. */
    async withSecret<T>(check: () => void, consume: (secret: string) => Promise<T>): Promise<T> {
      const { value } = await read(check);
      try { guard(check); const result = await consume(value.secret); guard(check); return result; }
      finally { value.pepper.fill(0); }
    },
    async changePin(currentPin: string, nextPin: string, check: () => void): Promise<void> {
      if (!isNativePin(nextPin)) throw unavailable();
      const accepted = await this.authenticate(currentPin, check, async () => true);
      if (!accepted) throw new Error('INVALID_CREDENTIAL');
      await this.withSecret(check, async secret => {
        const expected = await storage.read(); guard(check); if (!expected) throw unavailable();
        const next = await this.stage(nextPin, expected, secret, check);
        // An uncertain COMMIT must retain the new OS alias for reconciliation.
        await storage.replace(expected, next, check); guard(check);
        await port.remove(expected); guard(check);
      });
    },
  });
}
