/** One exact candidate identity for build scripts and the native qualifier. */
export const QUALIFICATION_SDK_IDENTITY_STAGE = 'native SDK candidate identity';
const exactVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

export function composeQualificationSdkIdentity(version: unknown, quickCrypto?: unknown, feeRate?: unknown): string {
  if (typeof version !== 'string' || (/\s/.test(version) || !exactVersion.test(version))) throw Error('Expected an exact shared keyring pin');
  for (const identity of [quickCrypto, feeRate]) {
    if (identity !== undefined && (typeof identity !== 'string' || identity.length > 512 || /\s/.test(identity) || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(identity)))
      throw Error('Invalid qualification candidate identity');
  }
  return [version, quickCrypto, feeRate].filter(value => value !== undefined).join('.');
}

export function assertQualificationSdkIdentity(actual: unknown, version: unknown, quickCrypto?: unknown, feeRate?: unknown): void {
  if (actual !== composeQualificationSdkIdentity(version, quickCrypto, feeRate))
    throw Error('QUALIFICATION_SDK_IDENTITY_MISMATCH');
}
