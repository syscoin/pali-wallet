import { CRYPTO_FULL_CASES } from './diagnostics.ts';
import type { CryptoFullCase } from './diagnostics.ts';
import vectors from '../../tests/crypto-vectors.json' with { type: 'json' };
import { Buffer } from 'buffer';
import { disposeWalletCrypto } from './provider.ts';
import { qualifyWalletCrypto } from './qualification.ts';

const unhex = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(text.match(/../g) ?? [], (part) => Number.parseInt(part, 16));
const hex = (data: ArrayBuffer): string =>
  Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, '0')).join('');
const same = (data: ArrayBuffer, expected: string) => {
  if (hex(data) !== expected) throw new Error('Known answer mismatch');
};
async function rejects(operation: () => Promise<unknown>, name: string): Promise<void> {
  try { await operation(); } catch (error) {
    if (error instanceof Error && error.name === name) return;
    throw new Error('Wrong failure classification');
  }
  throw new Error('Invalid operation accepted');
}

export type FullCryptoQualification = Readonly<{
  passed: true;
  productionIterations: 900000;
  cases: readonly Readonly<{ name: string; milliseconds: number }>[];
}>;

/**
 * CI/device qualification only: public synthetic fixtures, never user data.
 * Call with the actual native facade in a non-debugger Hermes binary. The report
 * alone does not identify a device/provider; the calling harness records those.
 */
export async function qualifyWalletCryptoFull(
  provider: Crypto,
  freshProvider?: () => Crypto,
  onCase?: (name: CryptoFullCase) => void
): Promise<FullCryptoQualification> {
  const cases: { name: string; milliseconds: number }[] = [];
  const step = (name: string) => {
    if (!CRYPTO_FULL_CASES.includes(name as CryptoFullCase)) throw Error('CRYPTO_DIAGNOSTIC_INVALID');
    try { onCase?.(name as CryptoFullCase); } catch { /* Diagnostic observers cannot alter qualification. */ }
  };
  const run = async (name: string, operation: () => Promise<void>) => {
    step(name);
    const start = performance.now();
    try { await operation(); }
    catch { throw new Error(`CRYPTO_QUALIFICATION_FAILED:${name}`); }
    cases.push(Object.freeze({ name, milliseconds: performance.now() - start }));
  };
  const subtle = provider.subtle;
  await run('startup-known-answers', () => qualifyWalletCrypto(provider));
  for (const vector of vectors.pbkdf2) {
    for (const viewType of ['uint8-offset', 'data-view-offset', 'buffer-offset'] as const) {
      await run(`${vector.id}:${viewType}`, async () => {
        const raw = unhex(vector.passwordUtf8Hex);
        const padded = new Uint8Array(raw.length + 10).fill(0x7e);
        padded.set(raw, 5);
        const view = viewType === 'uint8-offset'
          ? padded.subarray(5, 5 + raw.length)
          : viewType === 'data-view-offset' ? new DataView(padded.buffer, 5, raw.length)
          : Buffer.from(padded.buffer, 5, raw.length);
        const key = await subtle.importKey('raw', view, 'PBKDF2', false, ['deriveBits']);
        same(await subtle.deriveBits({ name: 'PBKDF2', hash: vector.hash, salt: unhex(vector.saltHex), iterations: vector.iterations }, key, vector.outputBytes * 8), vector.expectedHex);
        if (padded[0] !== 0x7e || padded[padded.length - 1] !== 0x7e)
          throw new Error('Input view boundary changed');
      });
    }
  }
  const hkdf = vectors.hkdf;
  step('sdk-hkdf-key-import');
  const root = await subtle.importKey('raw', unhex(hkdf.rootUtf8Hex), 'HKDF', false, ['deriveBits', 'deriveKey']);
  await run('sdk-hkdf-profile', async () => {
    same(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: unhex(hkdf.saltHex), info: unhex(hkdf.profileInfoHex) }, root, 256), hkdf.profileHex);
  });
  step('sdk-hkdf-domain-key');
  const domain = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unhex(hkdf.saltHex), info: unhex(hkdf.keyInfoHex) }, root,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  for (const vector of vectors.aes) {
    step(`${vector.id}:key-import`);
    const key = await subtle.importKey('raw', unhex(vector.keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const params = { name: 'AES-GCM', iv: unhex(vector.ivHex), additionalData: unhex(vector.aadHex ?? ''), tagLength: 128 };
    await run(`${vector.id}:known-answer`, async () => {
      same(await subtle.encrypt(params, key, unhex(vector.plaintextHex)), vector.ciphertextAndTagHex);
      same(await subtle.decrypt(params, key, unhex(vector.ciphertextAndTagHex)), vector.plaintextHex);
      if (vector.aadHex) same(await subtle.encrypt(params, domain, unhex(vector.plaintextHex)), vector.ciphertextAndTagHex);
    });
    for (const mutation of ['tag', 'ciphertext', 'iv', 'aad', 'key'] as const) {
      await run(`${vector.id}:reject-${mutation}`, async () => {
        const ciphertext = unhex(vector.ciphertextAndTagHex);
        const iv = unhex(vector.ivHex);
        let aad = unhex(vector.aadHex ?? '');
        let target = key;
        if (mutation === 'tag') ciphertext[ciphertext.length - 1] = ciphertext[ciphertext.length - 1]! ^ 1;
        if (mutation === 'ciphertext') ciphertext[0] = ciphertext[0]! ^ 1;
        if (mutation === 'iv') iv[0] = iv[0]! ^ 1;
        if (mutation === 'aad') { aad = new Uint8Array(aad.length + 1); aad.set(unhex(vector.aadHex ?? '')); }
        if (mutation === 'key') target = await subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['decrypt']);
        await rejects(() => subtle.decrypt({ ...params, iv, additionalData: aad }, target, ciphertext), 'OperationError');
      });
    }
    await run(`${vector.id}:reject-invalid-arguments`, async () => {
      await rejects(() => subtle.decrypt({ ...params, iv: new Uint8Array(16) }, key, unhex(vector.ciphertextAndTagHex)), 'RangeError');
      await rejects(() => subtle.decrypt({ ...params, tagLength: 96 }, key, unhex(vector.ciphertextAndTagHex)), 'NotSupportedError');
      await rejects(() => subtle.decrypt(params, key, new Uint8Array(15)), 'TypeError');
    });
  }
  await run('backup-pbkdf2-derived-key', async () => {
    const vector = vectors.pbkdf2[2]!;
    const material = await subtle.importKey('raw', unhex(vector.passwordUtf8Hex), 'PBKDF2', false, ['deriveKey']);
    const derived = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-512', salt: unhex(vector.saltHex), iterations: 900000 }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const reference = await subtle.importKey('raw', unhex(vector.expectedHex), 'AES-GCM', false, ['encrypt']);
    const params = { name: 'AES-GCM', iv: new Uint8Array(12), additionalData: new Uint8Array(64) };
    const plaintext = new Uint8Array([1, 2, 3]);
    const expected = await subtle.encrypt(params, reference, plaintext);
    same(await subtle.encrypt(params, derived, plaintext), hex(expected));
    await rejects(() => subtle.exportKey('raw', derived), 'NotSupportedError');
  });
  await run('backup-eight-mib-boundary', async () => {
    const params = { name: 'AES-GCM', iv: new Uint8Array(12), additionalData: new Uint8Array(64) };
    const key = await subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const plaintext = new Uint8Array(8 * 1024 * 1024).fill(0x37);
    const encrypted = await subtle.encrypt(params, key, plaintext);
    const decrypted = new Uint8Array(await subtle.decrypt(params, key, encrypted));
    if (encrypted.byteLength !== plaintext.length + 16 || decrypted.length !== plaintext.length || decrypted.some((byte) => byte !== 0x37))
      throw new Error('Large payload mismatch');
    plaintext.fill(0); decrypted.fill(0); new Uint8Array(encrypted).fill(0);
    await rejects(() => subtle.encrypt(params, key, new Uint8Array(8 * 1024 * 1024 + 1)), 'RangeError');
    await rejects(() => subtle.decrypt(params, key, new Uint8Array(8 * 1024 * 1024 + 17)), 'RangeError');
    await rejects(() => subtle.digest('SHA-256', new Uint8Array(1024 * 1024 + 1)), 'RangeError');
  });
  await run('random-view-boundaries', async () => {
    const padded = new Uint8Array(40).fill(0x7e);
    const view = padded.subarray(4, 36);
    if (provider.getRandomValues(view) !== view || padded.slice(0, 4).some((byte) => byte !== 0x7e) || padded.slice(36).some((byte) => byte !== 0x7e))
      throw new Error('Random view boundary changed');
  });
  if (freshProvider) await run('opaque-key-owner-and-disposal', async () => {
    const fresh = freshProvider();
    try {
      const params = { name: 'AES-GCM', iv: new Uint8Array(12) };
      const key = await fresh.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
      await rejects(() => subtle.encrypt(params, key, new Uint8Array()), 'InvalidAccessError');
      disposeWalletCrypto(fresh);
      await rejects(() => fresh.subtle.encrypt(params, key, new Uint8Array()), 'InvalidStateError');
      // Closing this independent context must not close the app-wide provider.
      await subtle.digest('SHA-256', new Uint8Array());
    } finally { disposeWalletCrypto(fresh); }
  });
  return Object.freeze({ passed: true, productionIterations: 900000, cases: Object.freeze(cases) });
}
