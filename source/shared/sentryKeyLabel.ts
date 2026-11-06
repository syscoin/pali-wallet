/** SHAKE-128s serializes SK.seed, SK.prf, PK.seed and PK.root in that order. */
export function sentryShakePrivateLabelParts(secretKey: string): string[] {
  if (!/^(?:0x)?[0-9a-f]{128}$/i.test(secretKey)) return [];
  const key = secretKey.slice(-128).toLowerCase();
  return [key.slice(0, 32), key.slice(32, 64)];
}

export function sentryPrivateLabelParts(secretKey: string): string[] {
  const shakeParts = sentryShakePrivateLabelParts(secretKey);
  if (shakeParts.length) return shakeParts;
  const key = secretKey.replace(/^0x/i, '').toLowerCase();
  return key.length >= 50 ? [key] : [];
}
