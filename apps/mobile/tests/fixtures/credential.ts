import { captureNativeCredentialReference, type NativeCredentialOwner, type NativeCredentialPort } from '../../src/custody/credentialVault.ts';

/** OS boundary fixture: public metadata reads never authorize a secret read. */
export function createTestCredentialPort() {
  const values = new Map<string, { header: string; secret: string; publicKey: number[] }>();
  let secretReads = 0;
  let authorizations = 0;
  let refused: Error | null = null;
  let beforeRead: ((owner: NativeCredentialOwner) => Promise<void>) | null = null;
  const id = (input: Parameters<NativeCredentialPort['readPublic']>[0]) => {
    const reference = captureNativeCredentialReference(input);
    return { reference, key: `${reference.installationId}:${reference.enrollmentId}` };
  };
  const check = (owner: NativeCredentialOwner) => { if (owner.signal.aborted) throw Object.assign(new Error('CREDENTIAL_CANCELLED'), { code: 'CREDENTIAL_CANCELLED' }); owner.assertCurrent(); };
  const port: NativeCredentialPort = {
    async capabilities(reference) { return { deviceAuth: 'ready', credentialPresent: reference !== null && values.has(id(reference).key) }; },
    async readPublic(input, guard) {
      guard(); const { reference, key } = id(input), value = values.get(key);
      if (!value) return null;
      if (value.header !== JSON.stringify(reference)) throw Error('CREDENTIAL_UNAVAILABLE');
      guard(); return Uint8Array.from(value.publicKey);
    },
    async withSecret(input, owner, consume) {
      check(owner); secretReads++;
      if (refused) { const error = refused; refused = null; throw error; }
      await beforeRead?.(owner); check(owner);
      const { reference, key } = id(input), value = values.get(key);
      if (!value) throw Object.assign(new Error('CREDENTIAL_MISSING'), { code: 'CREDENTIAL_MISSING' });
      if (value.header !== JSON.stringify(reference)) throw Error('CREDENTIAL_UNAVAILABLE');
      const result = await consume(value.secret); check(owner); return result;
    },
    async authorize(input, owner) {
      check(owner); authorizations++;
      if (refused) { const error = refused; refused = null; throw error; }
      await beforeRead?.(owner); check(owner);
      const { reference, key } = id(input), value = values.get(key);
      if (!value) throw Object.assign(new Error('CREDENTIAL_MISSING'), { code: 'CREDENTIAL_MISSING' });
      if (value.header !== JSON.stringify(reference)) throw Error('CREDENTIAL_UNAVAILABLE');
      check(owner);
    },
    async stage(input, value, owner) {
      check(owner); const { reference, key } = id(input);
      values.set(key, { header: JSON.stringify(reference), secret: value.secret, publicKey: [...value.publicKey] }); check(owner);
    },
    async remove(input) { values.delete(id(input).key); },
  };
  return { ...port,
    get secretReads() { return secretReads; },
    get authorizations() { return authorizations; },
    refuseNext(error: Error) { refused = error; },
    beforeRead(callback: ((owner: NativeCredentialOwner) => Promise<void>) | null) { beforeRead = callback; },
  };
}
