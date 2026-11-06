import vectors from '../../tests/crypto-vectors.json' with { type: 'json' };

const unhex = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const hex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Explicit native qualification only. This does not enable an SLH-DSA signer. */
export async function qualifyWalletHmac(provider: Crypto): Promise<Readonly<{
  passed: true;
  cases: readonly string[];
}>> {
  const cases: string[] = [];
  for (const vector of vectors.hmacSha512) {
    const key = await provider.subtle.importKey('raw', unhex(vector.keyHex),
      { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const result = await provider.subtle.sign('HMAC', key, unhex(vector.dataHex));
    if (hex(result) !== vector.expectedHex || key.extractable ||
        key.usages.length !== 1 || key.usages[0] !== 'sign')
      throw new Error('Native HMAC qualification failed');
    cases.push(vector.id);
  }
  return Object.freeze({ passed: true, cases: Object.freeze(cases) });
}
