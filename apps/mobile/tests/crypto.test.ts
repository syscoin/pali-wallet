import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { createCipheriv, hkdf, pbkdf2, randomBytes, createHash, webcrypto } from 'node:crypto';
import { promisify } from 'node:util';
import { createWalletCrypto, disposeWalletCrypto } from '../src/crypto/provider.ts';
import type { NativeCryptoContext, NativeCryptoModule, NativeKey } from '../src/crypto/provider.ts';
import { qualifyWalletCrypto } from '../src/crypto/qualification.ts';
import { CRYPTO_FULL_CASES, isCryptoDiagnostic } from '../src/crypto/diagnostics.ts';
import { qualifyWalletCryptoFull } from '../src/crypto/qualificationFull.ts';

const fixtures = JSON.parse(readFileSync(new URL('./crypto-vectors.json', import.meta.url), 'utf8'));
const unhex = (hex: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(hex, 'hex'));
const hex = (data: ArrayBuffer) => Buffer.from(data).toString('hex');
const nodePbkdf2 = promisify(pbkdf2);
const nodeHkdf = promisify(hkdf);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

/** Test-only Node control for the bridge contract, never a production fallback. */
function bridge() {
  const material = new WeakMap<object, Uint8Array<ArrayBuffer>>();
  const owned = new Set<Uint8Array<ArrayBuffer>>();
  let closed = false;
  let closes = 0;
  const keyBytes = (key: NativeKey) => {
    assert.equal(closed, false);
    const bytes = material.get(key);
    assert.ok(bytes);
    return bytes;
  };
  const makeKey = (raw: Uint8Array) => {
    assert.equal(closed, false);
    const key = {};
    const bytes = new Uint8Array(raw);
    material.set(key, bytes); owned.add(bytes);
    return key;
  };
  const context: NativeCryptoContext = {
    importKey(_kind, _usages, raw) { return makeKey(raw); },
    async pbkdf2(key, salt, iterations, hash, length) {
      return new Uint8Array(await nodePbkdf2(keyBytes(key), salt, iterations, length, hash.replace('-', '').toLowerCase()));
    },
    async pbkdf2Key(key, salt, iterations, hash) {
      return makeKey(new Uint8Array(await nodePbkdf2(keyBytes(key), salt, iterations, 32, hash.replace('-', '').toLowerCase())));
    },
    async hkdfBits(key, salt, info, length) {
      return new Uint8Array(await nodeHkdf('sha256', keyBytes(key), salt, info, length));
    },
    async hkdfKey(key, salt, info) {
      return makeKey(new Uint8Array(await nodeHkdf('sha256', keyBytes(key), salt, info, 32)));
    },
    async encrypt(key, iv, aad, plaintext) {
      const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
      cipher.setAAD(aad);
      return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]));
    },
    async decrypt(key, iv, aad, ciphertext) {
      const k = await webcrypto.subtle.importKey('raw', keyBytes(key), 'AES-GCM', false, ['decrypt']);
      try {
        return { status: 'authenticated', data: new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, ciphertext)) };
      } catch (failure) {
        if (failure instanceof Error && failure.name === 'OperationError') return { status: 'authentication-rejected' };
        throw failure;
      }
    },
    randomBytes(length) { return new Uint8Array(randomBytes(length)); },
    async digestSha256(data) { return new Uint8Array(createHash('sha256').update(data).digest()); },
    close() { closes++; closed = true; for (const bytes of owned) bytes.fill(0); },
  };
  const module: NativeCryptoModule = { info: () => ({ apiVersion: 1, implementation: 'android-jca-bc' }), createContext: () => context };
  return { context, provider: createWalletCrypto(module), get closes() { return closes; } };
}

test('startup known answers pass through the bounded facade using a Node bridge control', async () => {
  const { provider } = bridge();
  const checkpoints: string[] = [];
  await qualifyWalletCrypto(provider, (step) => { checkpoints.push(step); throw Error('ignored observer error'); });
  assert.equal(checkpoints[0], 'self-test-sha256');
  assert.equal(checkpoints.at(-1), 'self-test-key-metadata');
  assert(checkpoints.every((bootstrap) => isCryptoDiagnostic({ bootstrap })));
});

test('full native-harness qualification routine passes against its Node reference control', async () => {
  const { provider } = bridge();
  const checkpoints: string[] = [];
  const report = await qualifyWalletCryptoFull(provider, () => bridge().provider, (name) => { checkpoints.push(name); });
  assert.deepEqual(checkpoints, CRYPTO_FULL_CASES);
  assert.equal(report.passed, true);
  assert.equal(report.productionIterations, 900000);
  assert.equal(report.cases.length, 29);
});

test('unchanged 20k/900k Unicode PBKDF2 matches SDK fixtures and preserves offset views', async () => {
  const { provider } = bridge();
  for (const vector of fixtures.pbkdf2) {
    const padded = new Uint8Array(unhex(vector.passwordUtf8Hex).length + 8).fill(0x77);
    padded.set(unhex(vector.passwordUtf8Hex), 4);
    const key = await provider.subtle.importKey('raw', new DataView(padded.buffer, 4, padded.length - 8), 'PBKDF2', false, ['deriveBits']);
    const result = await provider.subtle.deriveBits({ name: 'PBKDF2', hash: vector.hash, salt: unhex(vector.saltHex), iterations: vector.iterations }, key, 256);
    assert.equal(hex(result), vector.expectedHex);
    assert.equal(padded[0], 0x77);
  }
  const raw = unhex('ff0080fe');
  const key = await provider.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveBits']);
  assert.equal(hex(await provider.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex('0001'), iterations: 20 }, key, 256)),
    (await nodePbkdf2(raw, unhex('0001'), 20, 32, 'sha256')).toString('hex'));
});

test('SDK HKDF profile/domain keys and AES-GCM envelopes match public fixtures', async () => {
  const { provider } = bridge();
  const vector = fixtures.hkdf;
  const root = await provider.subtle.importKey('raw', unhex(vector.rootUtf8Hex), 'HKDF', false, ['deriveBits', 'deriveKey']);
  assert.equal(hex(await provider.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: unhex(vector.saltHex), info: unhex(vector.profileInfoHex) }, root, 256)), vector.profileHex);
  const domainKey = await provider.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unhex(vector.saltHex), info: unhex(vector.keyInfoHex) }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  assert.equal(domainKey.extractable, false);
  for (const v of fixtures.aes) {
    const key = await provider.subtle.importKey('raw', unhex(v.keyHex), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const parameters = { name: 'AES-GCM', iv: unhex(v.ivHex), ...(v.aadHex ? { additionalData: unhex(v.aadHex), tagLength: 128 } : {}) };
    assert.equal(hex(await provider.subtle.encrypt(parameters, key, unhex(v.plaintextHex))), v.ciphertextAndTagHex);
    assert.equal(hex(await provider.subtle.decrypt(parameters, key, unhex(v.ciphertextAndTagHex))), v.plaintextHex);
    const damaged = unhex(v.ciphertextAndTagHex); damaged[0] = damaged[0]! ^ 1;
    await assert.rejects(provider.subtle.decrypt(parameters, key, damaged), { name: 'OperationError' });
    if (v.aadHex) assert.equal(hex(await provider.subtle.encrypt(parameters, domainKey, unhex(v.plaintextHex))), v.ciphertextAndTagHex);
  }
});

test('whole-note backup derives an opaque PBKDF2 AES key and supports the exact 8 MiB bound', async () => {
  const { provider } = bridge();
  const vector = fixtures.pbkdf2[2];
  const password = await provider.subtle.importKey('raw', unhex(vector.passwordUtf8Hex), 'PBKDF2', false, ['deriveKey']);
  const derived = await provider.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-512', salt: unhex(vector.saltHex), iterations: 900000 }, password,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const reference = await provider.subtle.importKey('raw', unhex(vector.expectedHex), 'AES-GCM', false, ['encrypt']);
  const parameters = { name: 'AES-GCM', iv: new Uint8Array(12), additionalData: new Uint8Array(64).fill(0x21), tagLength: 128 };
  const small = new Uint8Array([1, 2, 3]);
  assert.equal(hex(await provider.subtle.encrypt(parameters, derived, small)), hex(await provider.subtle.encrypt(parameters, reference, small)));
  assert.equal(derived.extractable, false);
  await assert.rejects(provider.subtle.exportKey('raw', derived), { name: 'NotSupportedError' });
  const payload = new Uint8Array(8 * 1024 * 1024).fill(0x37);
  const encrypted = await provider.subtle.encrypt(parameters, derived, payload);
  assert.equal(encrypted.byteLength, payload.length + 16);
  assert.equal(Buffer.from(await provider.subtle.decrypt(parameters, derived, encrypted)).equals(Buffer.from(payload)), true);
  const bad = new Uint8Array(encrypted); bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
  await assert.rejects(provider.subtle.decrypt(parameters, derived, bad), { name: 'OperationError' });
  await assert.rejects(provider.subtle.encrypt(parameters, derived, new Uint8Array(payload.length + 1)), RangeError);
  await assert.rejects(provider.subtle.decrypt(parameters, derived, new Uint8Array(payload.length + 17)), RangeError);
  await assert.rejects(provider.subtle.digest('SHA-256', new Uint8Array(1024 * 1024 + 1)), RangeError);
});

test('keys are opaque, nonextractable, usage checked and bound to one provider', async () => {
  const { provider } = bridge();
  const other = bridge().provider;
  const key = await provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
  assert.deepEqual(Object.keys(key).sort(), ['algorithm', 'extractable', 'type', 'usages']);
  assert.equal(Object.isFrozen(key), true);
  await assert.rejects(provider.subtle.exportKey('raw', key), { name: 'NotSupportedError' });
  await assert.rejects(provider.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(16)), { name: 'InvalidAccessError' });
  await assert.rejects(other.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array()), { name: 'InvalidAccessError' });
  await assert.rejects(provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', true, ['encrypt']), { name: 'NotSupportedError' });
  await assert.rejects(provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['deriveBits']), { name: 'SyntaxError' });
});

test('only explicit native authentication rejection becomes OperationError', async () => {
  const { provider, context } = bridge();
  const key = await provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['decrypt']);
  const params = { name: 'AES-GCM', iv: new Uint8Array(12) };
  context.decrypt = async () => { const e = new Error('provider fault'); e.name = 'OperationError'; throw e; };
  await assert.rejects(provider.subtle.decrypt(params, key, new Uint8Array(16)), { name: 'NativeCryptoError' });
  context.decrypt = async () => ({ status: 'authentication-rejected', data: new Uint8Array([1]) });
  await assert.rejects(provider.subtle.decrypt(params, key, new Uint8Array(16)), { name: 'NativeCryptoError' });
  context.decrypt = async () => ({ status: 'authentication-rejected' });
  await assert.rejects(provider.subtle.decrypt(params, key, new Uint8Array(16)), { name: 'OperationError' });
});

test('native plaintext buffers are cleared after copying to the authorized result', async () => {
  const { provider, context } = bridge();
  const key = await provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['decrypt']);
  const nativePlaintext = new Uint8Array([1, 2, 3]);
  context.decrypt = async () => ({ status: 'authenticated', data: nativePlaintext });
  const result = await provider.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(19));
  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3]);
  assert.deepEqual([...nativePlaintext], [0, 0, 0]);
});

test('input arrays and algorithm parameters are snapshotted before native work awaits', async () => {
  const { provider, context } = bridge();
  const key = await provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
  const gate = deferred();
  const original = context.encrypt;
  context.encrypt = async (...args) => { await gate.promise; return original(...args); };
  const data = new Uint8Array([1, 2, 3]);
  const params = { name: 'AES-GCM', iv: new Uint8Array(12), additionalData: new Uint8Array([7]) };
  const cipher = createCipheriv('aes-256-gcm', new Uint8Array(32), params.iv); cipher.setAAD(params.additionalData);
  const expectedHex = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]).toString('hex');
  const pending = provider.subtle.encrypt(params, key, data);
  data.fill(9); params.iv.fill(9); params.additionalData.fill(9); params.name = 'AES-CBC';
  gate.resolve();
  assert.equal(hex(await pending), expectedHex);
});

test('unsupported algorithms, malformed sizes and excessive work fail before native operations', async () => {
  const { provider } = bridge();
  const key = await provider.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  await assert.rejects(provider.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(16) }, key, new Uint8Array()), RangeError);
  await assert.rejects(provider.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 96 }, key, new Uint8Array()), { name: 'NotSupportedError' });
  await assert.rejects(provider.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, new Uint8Array(15)), TypeError);
  await assert.rejects(provider.subtle.digest('SHA-512', new Uint8Array()), { name: 'NotSupportedError' });
  const pass = await provider.subtle.importKey('raw', new Uint8Array(), 'PBKDF2', false, ['deriveBits']);
  await assert.rejects(provider.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: new Uint8Array(), iterations: 2_000_001 }, pass, 256), RangeError);
  await assert.rejects(provider.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: new Uint8Array(), iterations: 1 }, pass, 7), RangeError);
});

test('synchronous native entropy fills exactly the caller view and enforces WebCrypto limits', () => {
  const { provider, context } = bridge();
  context.randomBytes = (size) => new Uint8Array(size).fill(0x29);
  const buffer = new Uint8Array(12).fill(0x77);
  const view = new Uint16Array(buffer.buffer, 4, 2);
  assert.equal(provider.getRandomValues(view), view);
  assert.deepEqual([...buffer], [0x77, 0x77, 0x77, 0x77, 0x29, 0x29, 0x29, 0x29, 0x77, 0x77, 0x77, 0x77]);
  assert.throws(() => provider.getRandomValues(new Float32Array(2)), TypeError);
  assert.throws(() => provider.getRandomValues(new Uint8Array(65_537)), { name: 'QuotaExceededError' });
});

test('pending work is bounded and fatal disposal prevents later use and late output', async () => {
  const f = bridge();
  const gate = deferred();
  const original = f.context.digestSha256;
  f.context.digestSha256 = async (data) => { await gate.promise; return original(data); };
  const pending = Array.from({ length: 8 }, () => f.provider.subtle.digest('SHA-256', new Uint8Array()));
  await assert.rejects(f.provider.subtle.digest('SHA-256', new Uint8Array()), { name: 'QuotaExceededError' });
  disposeWalletCrypto(f.provider); disposeWalletCrypto(f.provider);
  assert.equal(f.closes, 1);
  gate.resolve();
  for (const result of pending) await assert.rejects(result, { name: 'InvalidStateError' });
  assert.throws(() => f.provider.getRandomValues(new Uint8Array()), { name: 'InvalidStateError' });
});

test('published SDK uses this facade for production-cost vault and private-record operations', async () => {
  const require = createRequire(import.meta.url);
  const { SoftwareKeyring, createKeyringHost, KeyringAccountType, INetworkType } = require('@sidhujag/sysweb3-keyring/cjs/software');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const previousEnv = [process.env.NODE_ENV, process.env.SYSWEB3_PBKDF2_ENC_ITERS];
  const f = bridge();
  const values = new Map<string, unknown>();
  const storage = {
    async get(key: string) { return values.get(key); },
    async set(key: string, value: unknown) { values.set(key, structuredClone(value)); },
    async deleteItem(key: string) { values.delete(key); },
    async createManyIfAbsent(items: Record<string, unknown>) {
      if (Object.keys(items).some((key) => values.has(key))) return false;
      for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
      return true;
    },
  };
  const keyring = new SoftwareKeyring(createKeyringHost(storage));
  const state = {
    activeAccount: { type: KeyringAccountType.HDAccount, id: 0 },
    activeNetwork: { kind: INetworkType.Ethereum, chainId: 1, slip44: 60, currency: 'ETH', label: 'Ethereum', url: 'https://offline.invalid' },
    accounts: { HDAccount: {} as Record<number, unknown>, Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {} },
  };
  keyring.setVaultStateGetter(() => state);
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: f.provider });
    process.env.NODE_ENV = 'production'; delete process.env.SYSWEB3_PBKDF2_ENC_ITERS;
    assert.equal(keyring.getEncIterations(), 900000);
    state.accounts.HDAccount[0] = await keyring.initializeWalletSecurely(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      'PUBLIC native-facade password 🔐'
    );
    const domain = 'org.syscoin.pali.privacy.notes.v1';
    const recordId = '00000000-0000-4000-8000-000000000001';
    const envelope = await keyring.encryptPrivateRecord({ domain, recordId, plaintext: new Uint8Array([1, 2, 3]) });
    assert.deepEqual(await keyring.decryptPrivateRecord({ domain, recordId, envelope }), new Uint8Array([1, 2, 3]));
    await keyring.lockWallet();
    assert.deepEqual(await keyring.unlock('PUBLIC wrong password'), { canLogin: false });
    const decrypt = f.context.decrypt;
    f.context.decrypt = async () => { throw new Error('synthetic native failure'); };
    await assert.rejects(keyring.unlock('PUBLIC native-facade password 🔐'), { name: 'NativeCryptoError' });
    f.context.decrypt = decrypt;
    assert.equal((await keyring.unlock('PUBLIC native-facade password 🔐')).canLogin, true);
  } finally {
    await keyring.lockWallet();
    disposeWalletCrypto(f.provider);
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
    for (const [index, key] of ['NODE_ENV', 'SYSWEB3_PBKDF2_ENC_ITERS'].entries()) {
      const old = previousEnv[index]; if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  }
});
