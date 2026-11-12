/** One exact candidate identity for build scripts and the native qualifier. */
export const QUALIFICATION_SDK_IDENTITY_STAGE = 'native SDK candidate identity';
const exactVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

export function composeQualificationSdkIdentity(version: unknown, quickCrypto?: unknown): string {
  if (typeof version !== 'string' || (/\s/.test(version) || !exactVersion.test(version))) throw Error('Expected an exact shared keyring pin');
  if (quickCrypto !== undefined && (typeof quickCrypto !== 'string' || quickCrypto.length > 512 || /\s/.test(quickCrypto) || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(quickCrypto)))
    throw Error('Invalid qualification candidate identity');
  return quickCrypto === undefined ? version : `${version}.${quickCrypto}`;
}

export function assertQualificationSdkIdentity(actual: unknown, version: unknown, quickCrypto?: unknown): void {
  if (actual !== composeQualificationSdkIdentity(version, quickCrypto))
    throw Error('QUALIFICATION_SDK_IDENTITY_MISMATCH');
}
