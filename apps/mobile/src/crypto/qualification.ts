import type { CryptoBootstrapStep } from './diagnostics.ts';
function hex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function expect(value: boolean): void {
  if (!value) throw new Error('Native wallet crypto qualification failed');
}

/**
 * Public known answers only. The one-iteration PBKDF2 test detects missing or
 * incompatible primitives; it NEVER replaces the SDK's production work factor.
 * Native binaries must additionally run the full 20k/900k/Unicode fixture suite.
 */
export async function qualifyWalletCrypto(provider: Crypto, onStep?: (step: CryptoBootstrapStep) => void): Promise<void> {
  const step = (label: CryptoBootstrapStep) => { try { onStep?.(label); } catch { /* Diagnostic observers cannot alter qualification. */ } };
  const subtle = provider.subtle;
  const encoder = new TextEncoder();
  step('self-test-sha256');
  expect(hex(await subtle.digest('SHA-256', encoder.encode('abc'))) ===
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  step('self-test-pbkdf2-import');
  const password = await subtle.importKey('raw', encoder.encode('password'), 'PBKDF2', false, ['deriveBits']);
  step('self-test-pbkdf2');
  expect(hex(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: encoder.encode('salt'), iterations: 1 }, password, 256)) ===
    '867f70cf1ade02cff3752599a3a53dc4af34c7a669815ae5d513554e1c8cf252');
  step('self-test-hkdf-import');
  const root = await subtle.importKey('raw', new Uint8Array(22).fill(11), 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: fromHex('000102030405060708090a0b0c'), info: fromHex('f0f1f2f3f4f5f6f7f8f9') };
  const derived = fromHex('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf');
  step('self-test-hkdf-bits');
  expect(hex(await subtle.deriveBits(params, root, 256)) === hex(derived.buffer));
  step('self-test-hkdf-key');
  const key = await subtle.deriveKey(params, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  step('self-test-aes-import');
  const reference = await subtle.importKey('raw', derived, 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12);
  const plaintext = encoder.encode('PUBLIC provider self-test');
  step('self-test-aes-encrypt');
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  expect(hex(encrypted) === hex(await subtle.encrypt({ name: 'AES-GCM', iv }, reference, plaintext)));
  step('self-test-aes-decrypt');
  expect(hex(await subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)) === hex(plaintext.buffer));
  step('self-test-aes-empty');
  const zeroKey = await subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  expect(hex(await subtle.encrypt({ name: 'AES-GCM', iv }, zeroKey, new Uint8Array())) ===
    '530f8afbc74536b9a963b4f1c4cb738b');
  step('self-test-aes-rejection');
  const damaged = new Uint8Array(encrypted);
  damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
  let rejected = false;
  try { await subtle.decrypt({ name: 'AES-GCM', iv }, key, damaged); }
  catch (error) { rejected = error instanceof Error && error.name === 'OperationError'; }
  expect(rejected);
  step('self-test-entropy');
  const random = new Uint8Array(32);
  expect(provider.getRandomValues(random) === random);
  // This is only an interface check; a statistical test cannot certify entropy.
  step('self-test-key-metadata');
  expect(key.extractable === false && Object.isFrozen(key.usages));
}
