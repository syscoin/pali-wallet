import { createNativePinVault, type NativePinCredentialPort, type NativePinStorage } from '../../src/custody/pinVault.ts';
import type { NativeKeyringSdk } from '../../src/custody/keyringSdk.ts';

type HostKeyring = InstanceType<NativeKeyringSdk['HostKeyring']>;

/** Real PIN proof and SDK lease for exceptional direct-SDK fixture setup. */
export async function withTestPinOperation<T>(
  storage: NativePinStorage, port: NativePinCredentialPort, ring: Pick<HostKeyring, 'withSecretOperation'>,
  pin: string, check: () => void, work: () => Promise<T>
): Promise<T> {
  const vault = createNativePinVault(storage, port);
  let authenticated: (() => Promise<void>) | undefined;
  return ring.withSecretOperation({ async withSecret(sdkCheck, consume) {
    const guard = () => { check(); sdkCheck(); check(); };
    await vault.withVerifiedSecret(pin, guard, async (secret, complete) => {
      authenticated = complete;
      await consume(secret);
    });
  } }, { signal: new AbortController().signal, assertCurrent: check }, async () => {
    if (!authenticated) throw Error('Fixture PIN proof missing');
    await authenticated(); check();
    return work();
  });
}

export function createTestPinRecordKeyring(
  storage: NativePinStorage, port: NativePinCredentialPort,
  ring: Pick<HostKeyring, 'withSecretOperation' | 'getPrivateRecordProfileId' | 'encryptPrivateRecord' | 'decryptPrivateRecord'>,
  pin: () => string, check: () => void
) {
  const run = <T>(work: () => Promise<T>) => withTestPinOperation(storage, port, ring, pin(), check, work);
  return Object.freeze({
    getPrivateRecordProfileId: () => run(() => ring.getPrivateRecordProfileId()),
    encryptPrivateRecord: (input: Parameters<HostKeyring['encryptPrivateRecord']>[0]) => run(() => ring.encryptPrivateRecord(input)),
    decryptPrivateRecord: (input: Parameters<HostKeyring['decryptPrivateRecord']>[0]) => run(() => ring.decryptPrivateRecord(input)),
  });
}
