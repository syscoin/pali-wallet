import { captureNativeCredentialReference, type NativeCredentialOwner, type NativeCredentialPort, type NativeCredentialReference } from '../src/custody/credentialVault.ts';
import { operationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';

export const QUALIFICATION_AUTHORIZATION_MODE = 'test-only-fixture' as const;
type Store = Readonly<{ get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; remove(name: string): Promise<void> }>;
const check = (owner: NativeCredentialOwner) => { if (owner.signal.aborted) throw Error('CANCELLED'); owner.assertCurrent(); if (owner.signal.aborted) throw Error('CANCELLED'); };
const alias = (value: NativeCredentialReference) => `fixture-${value.installationId}-${value.enrollmentId}`;
/** Public disposable qualification wallets only. This is deliberately not an OS-auth qualification. */
export function createQualificationCredentialPort(store: Store, iosId: unknown, androidId: unknown) {
  if (!['com.paliwallet.qualification', 'com.paliwallet.qualification.physical.import', 'com.paliwallet.qualification.physical.generate', 'com.paliwallet.qualification.physical.slh'].includes(String(iosId)) || androidId !== 'com.paliwallet.qualification')
    throw Error('QUALIFICATION_BUILD_IDENTIFIER_REQUIRED');
  let refusal = false, secretReads = 0;
  const read = async (input: NativeCredentialReference) => {
    const reference = captureNativeCredentialReference(input), raw = await store.get(alias(reference));
    if (raw === null) return null;
    if (raw.length > 1024) throw Error('QUALIFICATION_CREDENTIAL_INVALID');
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== 3 || value[0] !== JSON.stringify(reference) || typeof value[1] !== 'string' || !/^Pali#1:[0-9a-f]{64}$/.test(value[1]) || typeof value[2] !== 'string' || !/^[0-9a-f]{64}$/.test(value[2])) throw Error('QUALIFICATION_CREDENTIAL_INVALID');
    return value as [string, string, string];
  };
  const admit = (owner: NativeCredentialOwner) => { check(owner); if (refusal) { refusal = false; throw operationAuthenticationCancellation(); } };
  const port: NativeCredentialPort = {
    async capabilities(reference) { return { deviceAuth: 'ready', credentialPresent: reference !== null && await read(reference) !== null }; },
    async readPublic(reference, guard) { guard(); const value = await read(reference); guard(); return value === null ? null : Uint8Array.from(value[2].match(/../g)!, value => Number.parseInt(value, 16)); },
    async authorize(reference, owner) { admit(owner); if (!await read(reference)) throw Error('QUALIFICATION_CREDENTIAL_MISSING'); check(owner); },
    async withSecret(reference, owner, consume) { admit(owner); const value = await read(reference); check(owner); if (!value) throw Error('QUALIFICATION_CREDENTIAL_MISSING'); secretReads++; const result = await consume(value[1]); check(owner); return result; },
    async stage(input, value, owner) {
      admit(owner); const reference = captureNativeCredentialReference(input);
      if (await read(reference) !== null || !/^Pali#1:[0-9a-f]{64}$/.test(value.secret) || value.publicKey.length !== 32) throw Error('QUALIFICATION_CREDENTIAL_INVALID');
      check(owner); const raw = JSON.stringify([JSON.stringify(reference), value.secret, Array.from(value.publicKey, value => value.toString(16).padStart(2, '0')).join('')]);
      await store.set(alias(reference), raw); check(owner); if (await store.get(alias(reference)) !== raw) throw Error('QUALIFICATION_CREDENTIAL_INVALID'); check(owner);
    },
    async remove(input) { await store.remove(alias(captureNativeCredentialReference(input))); },
  };
  return Object.assign(port, { refuseNextAuthorization() { refusal = true; }, getSecretReads: () => secretReads });
}
