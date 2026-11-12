import { PALI_LANGUAGE_OPTIONS, type PaliLanguage } from '../../../../source/shared/languagePolicy.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { captureNativeCredentialReference, type NativeCredentialOwner, type NativeCredentialPort, type NativeCredentialReference } from '../custody/credentialVault.ts';
import { operationAuthenticationCancellation } from '../core/operationAuthentication.ts';

export type NativeCredentialRequest = Readonly<{ run(): Promise<unknown>; cancel(): void }>;
export type NativeCredentialModule = Readonly<{
  isCredentialPromptActive(): boolean;
  credentialCapabilities(binding: string | null): Promise<Readonly<{ deviceAuth: 'ready' | 'missing' | 'unsupported'; credentialPresent: boolean }>>;
  prepareCredentialRead(binding: string, language: PaliLanguage): NativeCredentialRequest;
  prepareCredentialAuthorization(binding: string, language: PaliLanguage): NativeCredentialRequest;
  prepareCredentialStage(binding: string, secret: string, language: PaliLanguage): NativeCredentialRequest;
  removeCredential(binding: string): Promise<void>;
}>;
export type NativeViewAuthorizationModule = Readonly<{
  prepareViewAuthorization(language: PaliLanguage): NativeCredentialRequest;
}>;
/** Only native-owned Android system credential UI may pause the host Activity. */
export function credentialPromptActivityState(platform: string, state: string, native: Pick<NativeCredentialModule, 'isCredentialPromptActive'>): string {
  return platform === 'android' && state === 'background' && native.isCredentialPromptActive() ? 'inactive' : state;
}
export const isNonBackgroundNativePromptActive = (state: string | null | undefined, isActive: () => boolean): boolean => (state === 'active' || state === 'inactive') && isActive();
type Ports = Readonly<{
  native: NativeCredentialModule;
  language(): PaliLanguage;
  publicStore: Readonly<{ get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; remove(name: string): Promise<void> }>;
  prompt<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>;
  setActive(request: NativeCredentialRequest | null): void;
}>;
const failure = (code = 'CREDENTIAL_UNAVAILABLE') => Object.assign(new Error(code), { code });
function credentialLanguage(ports: Pick<Ports, 'language'>): PaliLanguage {
  const value = ports.language();
  if (!PALI_LANGUAGE_OPTIONS.some(option => option.value === value)) throw failure();
  return value;
}
const binding = (reference: NativeCredentialReference) => {
  const value = captureNativeCredentialReference(reference);
  return JSON.stringify([1, value.installationId, value.walletBindingId, value.pairFingerprint, value.enrollmentId]);
};
const publicName = (reference: NativeCredentialReference) => `public-${reference.installationId}-${reference.enrollmentId}`;
type RequestAuthority = Pick<NativeCredentialOwner, 'signal' | 'assertCurrent'>;
const check = (owner: RequestAuthority) => {
  if (owner.signal.aborted) throw failure('CREDENTIAL_CANCELLED');
  assertSynchronousEvmFeeGuard(owner.assertCurrent);
  if (owner.signal.aborted) throw failure('CREDENTIAL_CANCELLED');
};
const secretValid = (value: unknown): value is string => typeof value === 'string' && /^Pali#1:[0-9a-f]{64}$/.test(value);

const captureOwner = (owner: NativeCredentialOwner): NativeCredentialOwner => {
  const captured = Object.freeze({ signal: owner.signal, assertCurrent: owner.assertCurrent, purpose: owner.purpose });
  if (!captured.signal || typeof captured.signal.addEventListener !== 'function' || typeof captured.signal.removeEventListener !== 'function' ||
      !['transaction', 'message', 'account-change', 'secret-read', 'private-reconciliation'].includes(captured.purpose)) throw failure();
  check(captured); return captured;
};

async function runRequest(ports: Pick<Ports, 'prompt' | 'setActive'>, owner: RequestAuthority, prepare: () => NativeCredentialRequest) {
    check(owner);
    const operation = prepare();
    const cancel = () => operation.cancel();
    let admitted = false;
    try {
      ports.setActive(operation); admitted = true;
      owner.signal.addEventListener('abort', cancel, { once: true });
      check(owner);
      const value = await ports.prompt(owner.signal, () => operation.run());
      check(owner); return value;
    } catch (error) {
      check(owner);
      const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
      if (code === 'CREDENTIAL_USER_CANCELLED') throw operationAuthenticationCancellation();
      if (code === 'CREDENTIAL_MISSING' || code === 'CREDENTIAL_CANCELLED' || code === 'CREDENTIAL_UNSUPPORTED') throw failure(code);
      throw failure();
    } finally {
      owner.signal.removeEventListener('abort', cancel);
      operation.cancel(); if (admitted) ports.setActive(null);
    }
}

/** A public-view authorization has no credential reference or storage capability. */
export function createPublicViewAuthorizer(ports: Pick<Ports, 'prompt' | 'setActive' | 'language'> & { native: NativeViewAuthorizationModule }) {
  return async (signal: AbortSignal, assertCurrent: () => void): Promise<void> => {
    const owner = Object.freeze({ signal, assertCurrent });
    check(owner);
    const result = await runRequest(ports, owner, () => ports.native.prepareViewAuthorization(credentialLanguage(ports)));
    if (result !== null && result !== undefined) throw failure();
    check(owner);
  };
}

/** The sole platform port supplying a secret to the shared operation-only SDK. */
export function createCredentialPort(ports: Ports): NativeCredentialPort {
  const run = (owner: NativeCredentialOwner, prepare: () => NativeCredentialRequest) => runRequest(ports, owner, prepare);
  return Object.freeze({
    async capabilities(reference) {
      const result = await ports.native.credentialCapabilities(reference === null ? null : binding(reference));
      if (!result || !['ready', 'missing', 'unsupported'].includes(result.deviceAuth) || typeof result.credentialPresent !== 'boolean' || Object.keys(result).length !== 2) throw failure();
      return Object.freeze({ deviceAuth: result.deviceAuth, credentialPresent: result.credentialPresent });
    },
    async readPublic(reference, guard) {
      const captured = captureNativeCredentialReference(reference), expected = binding(captured); assertSynchronousEvmFeeGuard(guard);
      const raw = await ports.publicStore.get(publicName(captured)); assertSynchronousEvmFeeGuard(guard);
      if (raw === null) return null;
      if (raw.length > 512) throw failure();
      const value: unknown = JSON.parse(raw);
      if (!Array.isArray(value) || value.length !== 2 || value[0] !== expected || typeof value[1] !== 'string' || !/^[0-9a-f]{64}$/.test(value[1])) throw failure();
      return Uint8Array.from(value[1].match(/../g)!, byte => Number.parseInt(byte, 16));
    },
    async authorize(reference, owner) {
      const expected = binding(reference); owner = captureOwner(owner);
      const result = await run(owner, () => ports.native.prepareCredentialAuthorization(expected, credentialLanguage(ports)));
      if (result !== null && result !== undefined) throw failure();
      check(owner);
    },
    async withSecret(reference, owner, consume) {
      const expected = binding(reference);
      owner = captureOwner(owner);
      let secret: unknown;
      try {
        secret = await run(owner, () => ports.native.prepareCredentialRead(expected, credentialLanguage(ports)));
        if (!secretValid(secret)) throw failure();
        check(owner); const result = await consume(secret); check(owner); return result;
      } finally { secret = undefined; }
    },
    async stage(reference, value, owner) {
      const captured = captureNativeCredentialReference(reference), expected = binding(captured);
      owner = captureOwner(owner);
      const properties = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(properties).length !== 2 || !properties.secret || !('value' in properties.secret) || !properties.publicKey || !('value' in properties.publicKey)) throw failure();
      const secret = properties.secret.value, publicKey = properties.publicKey.value;
      if (!secretValid(secret) || !(publicKey instanceof Uint8Array) || publicKey.length !== 32) throw failure();
      const publicBytes = new Uint8Array(publicKey);
      try {
        const raw = JSON.stringify([expected, Array.from(publicBytes, byte => byte.toString(16).padStart(2, '0')).join('')]);
        if (await ports.publicStore.get(publicName(captured)) !== null) throw failure();
        check(owner);
        const result = await run(owner, () => ports.native.prepareCredentialStage(expected, secret, credentialLanguage(ports)));
        if (result !== null && result !== undefined) throw failure();
        check(owner); await ports.publicStore.set(publicName(captured), raw); check(owner);
        if (await ports.publicStore.get(publicName(captured)) !== raw) throw failure();
        check(owner);
      } finally { publicBytes.fill(0); }
    },
    async remove(reference) {
      const captured = captureNativeCredentialReference(reference), expected = binding(captured);
      await ports.native.removeCredential(expected);
      await ports.publicStore.remove(publicName(captured));
    },
  });
}
