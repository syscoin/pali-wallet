import type { RecoveryStorageSnapshot } from '../storage/types.ts';
/** Native local authorization. PINs never become SDK vault encryption passwords. */
export type NativePinRecord = Readonly<{
  version: 1; installationId: string; walletBindingId: string; pairFingerprint: string;
  enrollmentId: string; salt: string; verifier: string;
}>;
/** This credential can open only the authenticated public checkpoint. */
export type NativePinPublicCredential = Readonly<{ publicKey: Uint8Array; pepper: Uint8Array }>;
export type NativePinCredential = NativePinPublicCredential & Readonly<{ secret: string }>;
export type NativePinCredentialPort = Readonly<{
  readPublic(record: NativePinRecord, check: () => void): Promise<NativePinPublicCredential | null>;
  readSecret(record: NativePinRecord, check: () => void): Promise<string | null>;
  stage(record: NativePinRecord, value: NativePinCredential, check: () => void): Promise<void>;
  remove(record: NativePinRecord): Promise<void>;
}>;
export type NativePinStorage = Readonly<{
  installationId: string;
  read(): Promise<NativePinRecord | null>;
  beginAttempt(record: NativePinRecord, check: () => void): Promise<object>;
  completeAttempt(attempt: object, check: () => void): Promise<void>;
  /** Persist the staged alias cleanup receipt before its OS secret can exist. */
  prepareReplacement(expected: NativePinRecord, next: NativePinRecord, check: () => void): Promise<void>;
  replace(expected: NativePinRecord, next: NativePinRecord, check: () => void): Promise<void>;
  /** Settle the existing durable obsolete-credential receipt before ordinary use. */
  settleCredentialRemoval(remove: (record: NativePinRecord) => Promise<void>): Promise<void>;
}>;
/** Runs before a normal wallet is admitted, including after a process restart. */
export async function settleNativePinRemoval(
  storage: Pick<import('../storage/types.ts').OpenWalletStorage, 'removal'>,
  credentials: NativePinCredentialPort | null
): Promise<void> {
  if (storage.removal) await storage.removal.settlePinCredential(async record => {
    if (!credentials) throw unavailable();
    await credentials.remove(record);
  });
}
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
function publicCredential(value: NativePinPublicCredential | null): asserts value is NativePinPublicCredential {
  if (!value || !(value.publicKey instanceof Uint8Array) || value.publicKey.length !== 32 || !(value.pepper instanceof Uint8Array) || value.pepper.length !== 32) throw unavailable();
}
const clearPublicCredential = (value: NativePinPublicCredential | null) => {
  if (value?.pepper instanceof Uint8Array) value.pepper.fill(0);
  if (value?.publicKey instanceof Uint8Array) value.publicKey.fill(0);
};
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
    const value = await port.readPublic(record, check);
    try { guard(check); publicCredential(value); return { record, value }; }
    catch (error) { clearPublicCredential(value); throw error; }
  };
  const readSecret = async (record: NativePinRecord, check: () => void) => {
    guard(check); const secret = await port.readSecret(record, check); guard(check);
    if (typeof secret !== 'string' || !/^Pali#1:[0-9a-f]{64}$/.test(secret)) throw unavailable();
    return secret;
  };
  const withVerifiedPublicKey = async <T>(pin: string, check: () => void, consume: (key: Uint8Array, authenticated: () => Promise<void>, record: NativePinRecord) => Promise<T>): Promise<T> => {
    if (!isNativePin(pin)) throw new Error('INVALID_CREDENTIAL');
    guard(check); const record = await storage.read(); guard(check); if (!record) throw unavailable();
    const attempt = await storage.beginAttempt(record, check); guard(check);
    let value: NativePinPublicCredential | null = null, completed = false;
    try {
      value = await port.readPublic(record, check); guard(check); publicCredential(value);
      if (!equal(await verifier(pin, record, value.pepper, check), record.verifier)) throw new Error('INVALID_CREDENTIAL');
      guard(check);
      const result = await consume(value.publicKey, async () => {
        guard(check); if (completed) throw unavailable();
        await storage.completeAttempt(attempt, check); guard(check); completed = true;
      }, record);
      guard(check); if (!completed) throw unavailable(); return result;
    } finally { clearPublicCredential(value); }
  };
  const withVerifiedSecret = <T>(pin: string, check: () => void, consume: (secret: string, authenticated: () => Promise<void>) => Promise<T>): Promise<T> =>
    withVerifiedPublicKey(pin, check, async (_key, authenticated, record) => consume(await readSecret(record, check), authenticated));
  const stage = async (pin: string, scope: Pick<NativePinRecord, 'walletBindingId' | 'pairFingerprint'>, secret: string, publicKey: Uint8Array, check: () => void,
    prepare?: (record: NativePinRecord) => Promise<void>): Promise<NativePinRecord> => {
    if (!isNativePin(pin)) throw unavailable(); guard(check);
    const pepper = random(32), salt = random(16), id = random(16);
    try {
      const base = captureNativePinRecord({ version: 1, installationId: storage.installationId, ...scope, enrollmentId: hex(id), salt: hex(salt), verifier: '0'.repeat(128) });
      const record = captureNativePinRecord({ ...base, verifier: await verifier(pin, base, pepper, check) });
      publicCredential({ publicKey, pepper });
      if (!/^Pali#1:[0-9a-f]{64}$/.test(secret)) throw unavailable();
      // Rotation records the next alias before any OS write. Generic initial
      // enrollment keeps its existing stage/cleanup behavior.
      if (prepare) { await prepare(record); guard(check); }
      try { await port.stage(record, { secret, publicKey, pepper }, check); guard(check); return record; }
      catch (error) {
        if (!prepare) await port.remove(record);
        throw error;
      }
    } finally { pepper.fill(0); salt.fill(0); id.fill(0); }
  };
  return Object.freeze({
    withVerifiedSecret,
    withVerifiedPublicKey,
    createSecret() { const value = random(32); try { return `Pali#1:${hex(value)}`; } finally { value.fill(0); } },
    createPublicKey: () => random(32),
    stage: (pin: string, scope: Pick<NativePinRecord, 'walletBindingId' | 'pairFingerprint'>, secret: string, publicKey: Uint8Array, check: () => void,
      prepare?: (record: NativePinRecord) => Promise<void>) => stage(pin, scope, secret, publicKey, check, prepare),
    async authenticate(pin: string, check: () => void): Promise<boolean> {
      try {
        return await withVerifiedPublicKey(pin, check, async (_key, authenticated) => {
          guard(check); await authenticated(); return true;
        });
      } catch (error) { if (error instanceof Error && error.message === 'INVALID_CREDENTIAL') return false; throw error; }
    },
    async withPublicKey<T>(check: () => void, consume: (key: Uint8Array) => Promise<T>): Promise<T> {
      const { value } = await read(check);
      try { guard(check); const result = await consume(value.publicKey); guard(check); return result; }
      finally { value.pepper.fill(0); value.publicKey.fill(0); }
    },
    /** Private custody only, after a fresh PIN or protected biometric proof in the same guarded operation. */
    async withSecret<T>(check: () => void, consume: (secret: string) => Promise<T>): Promise<T> {
      guard(check); const record = await storage.read(); guard(check); if (!record) throw unavailable();
      const result = await consume(await readSecret(record, check)); guard(check); return result;
    },
    async changePin(currentPin: string, nextPin: string, check: () => void): Promise<void> {
      if (!isNativePin(nextPin)) throw unavailable();
      const accepted = await this.authenticate(currentPin, check);
      if (!accepted) throw new Error('INVALID_CREDENTIAL');
      await this.withPublicKey(check, publicKey => this.withSecret(check, async secret => {
        const expected = await storage.read(); guard(check); if (!expected) throw unavailable();
        let staged: NativePinRecord | undefined;
        const removeTransitionCredential = (record: NativePinRecord) => {
          if (!staged || (JSON.stringify(record) !== JSON.stringify(expected) && JSON.stringify(record) !== JSON.stringify(staged))) throw unavailable();
          return port.remove(record);
        };
        try {
          const next = await stage(nextPin, expected, secret, publicKey, check, record => {
            staged = record;
            return storage.prepareReplacement(expected, record, check);
          });
          // The storage transaction retains the old alias in its existing
          // cleanup receipt atomically with installing the new PIN record.
          await storage.replace(expected, next, check);
        } catch (error) {
          // The receipt names NEXT before replacement and OLD after it. An
          // uncertain COMMIT poisons this owner and leaves cold open to settle
          // the durable outcome. Never guess which alias became current.
          try { if (staged) await storage.settleCredentialRemoval(removeTransitionCredential); }
          catch { /* The receipt remains durable until cleanup is acknowledged. */ }
          throw error;
        }
        // Cleanup is valid even if UI ownership ended after COMMIT. Failure
        // leaves the durable receipt and blocks this owner until settlement.
        await storage.settleCredentialRemoval(removeTransitionCredential);
        guard(check);
      }));
    },
  });
}

/** Public comparison only, after the exact pending OS credential cleanup was acknowledged. */
export function snapshotAfterNativePinCredentialCleanup(snapshot: RecoveryStorageSnapshot): RecoveryStorageSnapshot {
  return Object.freeze({ ...snapshot, metadata: Object.freeze(snapshot.metadata.filter(row => row.key !== 'removed-pin-credential')) });
}
