/** Host verification independently binds the full identity to the locked bytes. */
export function matchesQualificationSdkIdentity(
  version: unknown,
  identity: unknown,
  quickCryptoIdentity: unknown
): boolean {
  if (
    typeof version !== 'string' ||
    typeof identity !== 'string' ||
    typeof quickCryptoIdentity !== 'string' ||
    quickCryptoIdentity.length === 0
  )
    return false;
  const suffix = `.${quickCryptoIdentity}`;
  if (!identity.endsWith(suffix)) return false;
  const keyring = identity.slice(0, -suffix.length);
  if (keyring === version) return true;
  const candidatePrefix = `${version}.keyring.`;
  return (
    keyring.startsWith(candidatePrefix) &&
    /^[0-9a-f]{64}$/.test(keyring.slice(candidatePrefix.length))
  );
}
