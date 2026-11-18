/** One exact candidate identity for build scripts and the native qualifier. */
export const QUALIFICATION_SDK_IDENTITY_STAGE = 'native SDK candidate identity';
const exactVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

export function composeQualificationSdkIdentity(version: unknown, quickCrypto?: unknown, keyringPatch?: unknown): string {
  if (typeof version !== 'string' || (/\s/.test(version) || !exactVersion.test(version))) throw Error('Expected an exact shared keyring pin');
  const patches = [quickCrypto, keyringPatch].filter(value => value !== undefined);
  if (patches.some(value => typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value)))
    throw Error('Invalid qualification candidate identity');
  return [version, ...patches].join('.');
}

export function assertQualificationSdkIdentity(actual: unknown, version: unknown, quickCrypto?: unknown, keyringPatch?: unknown): void {
  if (actual !== composeQualificationSdkIdentity(version, quickCrypto, keyringPatch))
    throw Error('QUALIFICATION_SDK_IDENTITY_MISMATCH');
}
