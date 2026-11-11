import { createNativeCredentialVault, type NativeCredentialPort, type NativeCredentialStorage } from '../../src/custody/credentialVault.ts';
import type { NativeKeyringSdk } from '../../src/custody/keyringSdk.ts';
type HostKeyring = InstanceType<NativeKeyringSdk['HostKeyring']>;

/** Actual protected credential callback and SDK lease for direct-SDK test setup. */
export async function withTestCredentialOperation<T>(storage: NativeCredentialStorage, port: NativeCredentialPort,
  ring: Pick<HostKeyring, 'withSecretOperation'>, check: () => void, work: () => Promise<T>): Promise<T> {
  const vault = createNativeCredentialVault(storage, port), signal = new AbortController().signal;
  return ring.withSecretOperation({ async withSecret(sdkCheck, consume) {
    const guard = () => { check(); sdkCheck(); check(); };
    await vault.withSecret({ signal, assertCurrent: guard, purpose: 'account-change' }, consume);
  } }, { signal, assertCurrent: check }, work);
}
export function createTestCredentialRecordKeyring(storage: NativeCredentialStorage, port: NativeCredentialPort,
  ring: Pick<HostKeyring, 'withSecretOperation' | 'getPrivateRecordProfileId' | 'encryptPrivateRecord' | 'decryptPrivateRecord'>,
  check: () => void) {
  const run = <T>(work: () => Promise<T>) => withTestCredentialOperation(storage, port, ring, check, work);
  return Object.freeze({ getPrivateRecordProfileId: () => run(() => ring.getPrivateRecordProfileId()),
    encryptPrivateRecord: (input: Parameters<HostKeyring['encryptPrivateRecord']>[0]) => run(() => ring.encryptPrivateRecord(input)),
    decryptPrivateRecord: (input: Parameters<HostKeyring['decryptPrivateRecord']>[0]) => run(() => ring.decryptPrivateRecord(input)),
  });
}
