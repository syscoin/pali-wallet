import type { RecoveryStorageSnapshot } from '../storage/types.ts';

export type NativeCredentialReference = Readonly<{
  version: 1; installationId: string; walletBindingId: string; pairFingerprint: string; enrollmentId: string;
}>;
export type NativeCredentialPurpose = 'transaction' | 'message' | 'account-change' | 'secret-read' | 'private-reconciliation';
export type NativeCredentialOwner = Readonly<{
  signal: AbortSignal; assertCurrent(): void; purpose: NativeCredentialPurpose;
}>;
export type NativeCredentialPort = Readonly<{
  capabilities(reference: NativeCredentialReference | null): Promise<Readonly<{ deviceAuth: 'ready' | 'missing' | 'unsupported'; credentialPresent: boolean }>>;
  /** Device-only checkpoint key; never the SDK vault secret. No user prompt. */
  readPublic(reference: NativeCredentialReference, check: () => void): Promise<Uint8Array | null>;
  /** OS authorization using the protected credential's key/ACL; returns no secret. */
  authorize(reference: NativeCredentialReference, owner: NativeCredentialOwner): Promise<void>;
  /** Each invocation performs an actual OS-protected read for this owner. */
  withSecret<T>(reference: NativeCredentialReference, owner: NativeCredentialOwner, consume: (secret: string) => Promise<T>): Promise<T>;
  /** Caller durably records this exact new alias before staging it. */
  stage(reference: NativeCredentialReference, value: Readonly<{ secret: string; publicKey: Uint8Array }>, owner: NativeCredentialOwner): Promise<void>;
  /** Cleanup is deliberately independent of an already-retired UI owner. */
  remove(reference: NativeCredentialReference): Promise<void>;
}>;
export type NativeCredentialStorage = Readonly<{
  installationId: string;
  read(): Promise<NativeCredentialReference | null>;
  settleCredentialRemoval(remove: (reference: NativeCredentialReference) => Promise<void>): Promise<void>;
}>;

const unavailable = () => new Error('CREDENTIAL_UNAVAILABLE');
const hex = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export function captureNativeCredentialReference(value: unknown): NativeCredentialReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const own = Object.getOwnPropertyDescriptors(value);
  const names = ['version', 'installationId', 'walletBindingId', 'pairFingerprint', 'enrollmentId'];
  if (Reflect.ownKeys(own).length !== names.length || names.some(name => !own[name] || !('value' in own[name]!))) throw unavailable();
  const record = Object.fromEntries(names.map(name => [name, own[name]!.value]));
  if (record.version !== 1 || ['installationId', 'enrollmentId'].some(name => typeof record[name] !== 'string' || !/^[0-9a-f]{32}$/.test(record[name])) ||
      ['walletBindingId', 'pairFingerprint'].some(name => typeof record[name] !== 'string' || !/^[0-9a-f]{64}$/.test(record[name]))) throw unavailable();
  return Object.freeze(record) as NativeCredentialReference;
}
function check(guard: () => void) {
  const value: unknown = guard();
  if (value !== undefined) { void Promise.resolve(value).catch(() => undefined); throw unavailable(); }
}
function checkOwner(owner: NativeCredentialOwner) {
  if (!owner || !owner.signal || owner.signal.aborted || !['transaction', 'message', 'account-change', 'secret-read', 'private-reconciliation'].includes(owner.purpose)) throw unavailable();
  check(owner.assertCurrent);
  if (owner.signal.aborted) throw unavailable();
}
export function createNativeCredentialVault(storage: NativeCredentialStorage, port: NativeCredentialPort) {
  const random = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));
  const read = async (guard: () => void) => {
    check(guard); const value = await storage.read(); check(guard);
    if (!value) throw unavailable();
    return captureNativeCredentialReference(value);
  };
  return Object.freeze({
    createSecret() { const bytes = random(32); try { return `Pali#1:${hex(bytes)}`; } finally { bytes.fill(0); } },
    createPublicKey: () => random(32),
    createReference(scope: Pick<NativeCredentialReference, 'walletBindingId' | 'pairFingerprint'>): NativeCredentialReference {
      const bytes = random(16);
      try { return captureNativeCredentialReference({ version: 1, installationId: storage.installationId, ...scope, enrollmentId: hex(bytes) }); }
      finally { bytes.fill(0); }
    },
    async stage(reference: NativeCredentialReference, secret: string, publicKey: Uint8Array, owner: NativeCredentialOwner): Promise<void> {
      checkOwner(owner); captureNativeCredentialReference(reference);
      if (!/^Pali#1:[0-9a-f]{64}$/.test(secret) || !(publicKey instanceof Uint8Array) || publicKey.length !== 32) throw unavailable();
      await port.stage(reference, { secret, publicKey }, owner); checkOwner(owner);
    },
    async withPublicKey<T>(guard: () => void, consume: (key: Uint8Array) => Promise<T>): Promise<T> {
      const reference = await read(guard);
      const key = await port.readPublic(reference, guard);
      try {
        check(guard);
        if (!(key instanceof Uint8Array) || key.length !== 32) throw unavailable();
        const result = await consume(key); check(guard); return result;
      } finally { if (key instanceof Uint8Array) key.fill(0); }
    },
    async withSecret<T>(owner: NativeCredentialOwner, consume: (secret: string) => Promise<T>): Promise<T> {
      checkOwner(owner); const reference = await read(owner.assertCurrent); checkOwner(owner);
      let entered = false;
      const result = await port.withSecret(reference, owner, async secret => {
        if (entered) throw unavailable();
        entered = true;
        checkOwner(owner);
        if (typeof secret !== 'string' || !/^Pali#1:[0-9a-f]{64}$/.test(secret)) throw unavailable();
        const result = await consume(secret); checkOwner(owner); return result;
      });
      checkOwner(owner); if (!entered) throw unavailable(); return result;
    },
    async authorize(owner: NativeCredentialOwner): Promise<void> {
      checkOwner(owner); const reference = await read(owner.assertCurrent); checkOwner(owner);
      await port.authorize(reference, owner); checkOwner(owner);
    },
  });
}

export async function settleNativeCredentialRemoval(
  storage: Pick<import('../storage/types.ts').OpenWalletStorage, 'removal'>,
  credentials: NativeCredentialPort | null
): Promise<void> {
  if (storage.removal) await storage.removal.settleCredential(async reference => {
    if (!credentials) throw unavailable();
    await credentials.remove(reference);
  });
}
export function snapshotAfterNativeCredentialCleanup(snapshot: RecoveryStorageSnapshot): RecoveryStorageSnapshot {
  return Object.freeze({ ...snapshot, metadata: Object.freeze(snapshot.metadata.filter(row => row.key !== 'removed-credential')) });
}
