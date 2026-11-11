import Constants from 'expo-constants';
import { isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';
import { PHYSICAL_BUNDLES } from './physical-contract.ts';
import type { NativeCredentialOwner, NativeCredentialReference } from '../src/custody/credentialVault.ts';
import { createNativeCredentialPort } from '../src/platform/credential.native';

/** Interactive native boundary check. The normal crypto fixture never calls this. */
export async function qualifyNativeCredentialBoundary(owner: NativeCredentialOwner, random: (bytes: Uint8Array) => void) {
  if (!['com.paliwallet.qualification', ...Object.values(PHYSICAL_BUNDLES)].includes(Constants.expoConfig?.ios?.bundleIdentifier ?? '') || Constants.expoConfig?.android?.package !== 'com.paliwallet.qualification') throw Error('QUALIFICATION_BUILD_IDENTIFIER_REQUIRED');
  const port = createNativeCredentialPort();
  owner.assertCurrent();
  const capabilities = await port.capabilities(null); owner.assertCurrent();
  if (capabilities.deviceAuth !== 'ready') return Object.freeze({ status: 'unavailable' as const, deviceAuth: capabilities.deviceAuth, authorizationMode: 'native-os' as const });
  const bytes = new Uint8Array(160); random(bytes);
  const hex = (start: number, end: number) => Array.from(bytes.subarray(start, end), value => value.toString(16).padStart(2, '0')).join('');
  const reference: NativeCredentialReference = Object.freeze({ version: 1, installationId: hex(0, 16), walletBindingId: hex(16, 48), pairFingerprint: hex(48, 80), enrollmentId: hex(80, 96) });
  let secret: string | undefined = `Pali#1:${hex(96, 128)}`;
  const publicKey = bytes.slice(128, 160); bytes.fill(0);
  try {
    await port.stage(reference, { secret, publicKey }, owner);
    await port.authorize(reference, owner);
    let matched = false;
    await port.withSecret(reference, owner, async value => { owner.assertCurrent(); matched = value === secret; });
    if (!matched || !(await port.capabilities(reference)).credentialPresent) throw Error('NATIVE_CREDENTIAL_QUALIFICATION_FAILED');
    return Object.freeze({ status: 'passed' as const, authorizationMode: 'native-os' as const, protectedStageVerified: true, sameKeyAuthorizationVerified: true, protectedSecretReadVerified: true });
  } catch (error) {
    if (isOperationAuthenticationCancellation(error)) return Object.freeze({ status: 'cancelled' as const, authorizationMode: 'native-os' as const });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'CREDENTIAL_UNSUPPORTED')
      return Object.freeze({ status: 'unavailable' as const, deviceAuth: 'unsupported' as const, authorizationMode: 'native-os' as const });
    throw Error('NATIVE_CREDENTIAL_QUALIFICATION_FAILED');
  } finally { secret = undefined; publicKey.fill(0); await port.remove(reference); }
}
