/** Native-only subset used by the shared wallet SDK. No key export or fallback. */
export type NativeKey = object;

export interface NativeCryptoContext {
  importKey(kind: string, usages: string[], bytes: Uint8Array): NativeKey;
  pbkdf2(key: NativeKey, salt: Uint8Array, iterations: number, hash: string, length: number): Promise<Uint8Array>;
  pbkdf2Key(key: NativeKey, salt: Uint8Array, iterations: number, hash: string, usages: string[]): Promise<NativeKey>;
  hkdfBits(key: NativeKey, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  hkdfKey(key: NativeKey, salt: Uint8Array, info: Uint8Array, usages: string[]): Promise<NativeKey>;
  encrypt(key: NativeKey, iv: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  decrypt(key: NativeKey, iv: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Promise<{
    status: 'authenticated' | 'authentication-rejected';
    data?: Uint8Array | null;
  }>;
  randomBytes(length: number): Uint8Array;
  digestSha256(data: Uint8Array): Promise<Uint8Array>;
  close(): void;
}

export interface NativeCryptoModule {
  info(): { apiVersion: number; implementation: string };
  createContext(): NativeCryptoContext;
}

type KeyKind = 'AES-GCM' | 'PBKDF2' | 'HKDF';
type KeyRecord = { native: NativeKey; kind: KeyKind; usages: readonly KeyUsage[] };
const providers = new WeakMap<object, { close(): void }>();
const MAX_AES_DATA = 8 * 1024 * 1024;
const MAX_DIGEST_DATA = 1_048_576;
const MAX_PARAMETER = 65_536;
const MAX_KEY = 4_096;
const MAX_PENDING = 8;

function error(name: string, message: string): Error {
  const result = new Error(message);
  result.name = name;
  return result;
}

function unsupported(): never {
  throw error('NotSupportedError', 'This algorithm or operation is not supported by the wallet crypto provider');
}

function nativeSync<T>(operation: () => T): T {
  try { return operation(); }
  catch { throw error('NativeCryptoError', 'Native cryptographic operation failed'); }
}

async function nativeAsync<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch { throw error('NativeCryptoError', 'Native cryptographic operation failed'); }
}

function nameOf(algorithm: AlgorithmIdentifier): string {
  const name = typeof algorithm === 'string' ? algorithm : algorithm?.name;
  if (typeof name !== 'string') throw new TypeError('Invalid algorithm');
  return name.toUpperCase();
}

function bytes(input: BufferSource, maximum: number): Uint8Array {
  let view: Uint8Array;
  if (input instanceof ArrayBuffer) view = new Uint8Array(input);
  else if (ArrayBuffer.isView(input) && input.buffer instanceof ArrayBuffer)
    view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  else throw new TypeError('Expected a non-shared BufferSource');
  if (view.byteLength > maximum) throw new RangeError('Crypto input exceeds the supported size');
  return new Uint8Array(view);
}

function output(value: Uint8Array, length?: number): ArrayBuffer {
  if (!(value instanceof Uint8Array))
    throw error('NativeCryptoError', 'Invalid native crypto response');
  try {
    if (length !== undefined && value.length !== length)
      throw error('NativeCryptoError', 'Invalid native crypto response');
    return new Uint8Array(value).buffer;
  } finally { value.fill(0); }
}

function usagesFor(kind: KeyKind, usages: readonly KeyUsage[]): readonly KeyUsage[] {
  const allowed = kind === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['deriveBits', 'deriveKey'];
  if (!Array.isArray(usages) || usages.length === 0 || usages.length > 2 ||
    new Set(usages).size !== usages.length || usages.some((usage) => !allowed.includes(usage)))
    throw error('SyntaxError', 'Invalid key usages');
  return Object.freeze([...usages]);
}

/** The bridge argument is injectable for contract tests, never a crypto fallback. */
export function createWalletCrypto(module: NativeCryptoModule): Crypto {
  const info = nativeSync(() => module.info());
  if (info?.apiVersion !== 1 || !['apple-cryptokit-commoncrypto', 'android-jca-bc'].includes(info.implementation))
    throw error('NativeCryptoError', 'Unsupported native crypto module');
  const context = nativeSync(() => module.createContext());
  const keys = new WeakMap<object, KeyRecord>();
  let closed = false;
  let pending = 0;
  const assertOpen = () => { if (closed) throw error('InvalidStateError', 'Crypto provider is closed'); };
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertOpen();
    if (pending >= MAX_PENDING) throw error('QuotaExceededError', 'Too many pending crypto operations');
    pending++;
    try {
      const result = await operation();
      if (closed && result instanceof ArrayBuffer) new Uint8Array(result).fill(0);
      assertOpen();
      return result;
    } finally { pending--; }
  };
  const makeKey = (native: NativeKey, kind: KeyKind, usages: readonly KeyUsage[]): CryptoKey => {
    if (!native || typeof native !== 'object') throw error('NativeCryptoError', 'Invalid native key');
    const algorithm = Object.freeze(kind === 'AES-GCM' ? { name: kind, length: 256 } : { name: kind });
    const key = Object.freeze({ type: 'secret', extractable: false, algorithm, usages,
      [Symbol.toStringTag]: 'CryptoKey' }) as unknown as CryptoKey;
    keys.set(key, { native, kind, usages });
    return key;
  };
  const requireKey = (key: CryptoKey, kind: KeyKind, usage: KeyUsage): NativeKey => {
    assertOpen();
    const record = keys.get(key);
    if (!record || record.kind !== kind || !record.usages.includes(usage))
      throw error('InvalidAccessError', 'Key does not permit this operation');
    return record.native;
  };
  const gcm = (algorithm: AlgorithmIdentifier) => {
    if (nameOf(algorithm) !== 'AES-GCM' || typeof algorithm === 'string') unsupported();
    const params = algorithm as AesGcmParams;
    const tagLength = params.tagLength ?? 128;
    if (tagLength !== 128) unsupported();
    const iv = bytes(params.iv, 12);
    if (iv.length !== 12) throw new TypeError('AES-GCM requires a 12-byte IV');
    return { iv, aad: params.additionalData === undefined ? new Uint8Array() : bytes(params.additionalData, MAX_PARAMETER) };
  };
  const kdf = (algorithm: AlgorithmIdentifier) => {
    if (typeof algorithm === 'string') throw new TypeError('KDF parameters are required');
    const kind = nameOf(algorithm);
    if (kind !== 'PBKDF2' && kind !== 'HKDF') unsupported();
    const params = algorithm as Pbkdf2Params & HkdfParams;
    const hash = nameOf(params.hash);
    if (hash !== 'SHA-256' && hash !== 'SHA-512') unsupported();
    if (kind === 'HKDF' && hash !== 'SHA-256') unsupported();
    const iterations = kind === 'PBKDF2' ? params.iterations : 0;
    if (kind === 'PBKDF2' && (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 2_000_000))
      throw new RangeError('PBKDF2 iteration count is outside the supported range');
    return { kind, hash, iterations, salt: bytes(params.salt, MAX_PARAMETER),
      info: kind === 'HKDF' ? bytes(params.info, MAX_PARAMETER) : new Uint8Array() };
  };

  const subtle = {
    async importKey(format: KeyFormat, data: BufferSource, algorithm: AlgorithmIdentifier,
      extractable: boolean, requestedUsages: KeyUsage[]): Promise<CryptoKey> {
      assertOpen();
      if (format !== 'raw' || extractable !== false) unsupported();
      const kind = nameOf(algorithm) as KeyKind;
      if (!['AES-GCM', 'PBKDF2', 'HKDF'].includes(kind)) unsupported();
      const usages = usagesFor(kind, requestedUsages);
      const raw = bytes(data, MAX_KEY);
      try {
        if ((kind === 'AES-GCM' && raw.length !== 32) || (kind === 'HKDF' && raw.length === 0))
          throw error('DataError', 'Invalid key size');
        return makeKey(nativeSync(() => context.importKey(kind, [...usages], raw)), kind, usages);
      } finally { raw.fill(0); }
    },
    async deriveBits(algorithm: AlgorithmIdentifier, key: CryptoKey, length: number): Promise<ArrayBuffer> {
      const p = kdf(algorithm);
      try {
        if (!Number.isSafeInteger(length) || length < 8 || length > 512 || length % 8 !== 0)
          throw new RangeError('Invalid derived bit length');
        const native = requireKey(key, p.kind as KeyKind, 'deriveBits');
        return await run(async () => output(p.kind === 'PBKDF2'
          ? await nativeAsync(() => context.pbkdf2(native, p.salt, p.iterations, p.hash, length / 8))
          : await nativeAsync(() => context.hkdfBits(native, p.salt, p.info, length / 8)), length / 8));
      } finally { p.salt.fill(0); p.info.fill(0); }
    },
    async deriveKey(algorithm: AlgorithmIdentifier, key: CryptoKey, derived: AlgorithmIdentifier,
      extractable: boolean, requestedUsages: KeyUsage[]): Promise<CryptoKey> {
      const p = kdf(algorithm);
      try {
        if ((p.kind === 'PBKDF2' && p.hash !== 'SHA-512') || nameOf(derived) !== 'AES-GCM' || typeof derived === 'string' ||
          (derived as AesKeyGenParams).length !== 256 || extractable !== false) unsupported();
        const native = requireKey(key, p.kind as KeyKind, 'deriveKey');
        const usages = usagesFor('AES-GCM', requestedUsages);
        return await run(async () => makeKey(await nativeAsync(() => p.kind === 'PBKDF2'
          ? context.pbkdf2Key(native, p.salt, p.iterations, p.hash, [...usages])
          : context.hkdfKey(native, p.salt, p.info, [...usages])), 'AES-GCM', usages));
      } finally { p.salt.fill(0); p.info.fill(0); }
    },
    async encrypt(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
      const p = gcm(algorithm);
      const plaintext = bytes(data, MAX_AES_DATA);
      try {
        const native = requireKey(key, 'AES-GCM', 'encrypt');
        return await run(async () => output(await nativeAsync(() => context.encrypt(native, p.iv, p.aad, plaintext)), plaintext.length + 16));
      } finally { plaintext.fill(0); p.iv.fill(0); p.aad.fill(0); }
    },
    async decrypt(algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
      const p = gcm(algorithm);
      const ciphertext = bytes(data, MAX_AES_DATA + 16);
      try {
        if (ciphertext.length < 16) throw new TypeError('AES-GCM ciphertext is missing its tag');
        const native = requireKey(key, 'AES-GCM', 'decrypt');
        return await run(async () => {
          const result = await nativeAsync(() => context.decrypt(native, p.iv, p.aad, ciphertext));
          if (result?.status === 'authentication-rejected' && result.data == null)
            throw error('OperationError', 'AES-GCM authentication failed');
          if (result?.status !== 'authenticated') {
            if (result?.data instanceof Uint8Array) result.data.fill(0);
            throw error('NativeCryptoError', 'Invalid native decryption response');
          }
          return output(result.data!, ciphertext.length - 16);
        });
      } finally { ciphertext.fill(0); p.iv.fill(0); p.aad.fill(0); }
    },
    async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
      if (nameOf(algorithm) !== 'SHA-256') unsupported();
      const input = bytes(data, MAX_DIGEST_DATA);
      try { return await run(async () => output(await nativeAsync(() => context.digestSha256(input)), 32)); }
      finally { input.fill(0); }
    },
    exportKey: async () => unsupported(), generateKey: async () => unsupported(),
    sign: async () => unsupported(), verify: async () => unsupported(),
    wrapKey: async () => unsupported(), unwrapKey: async () => unsupported(),
  };
  const crypto = Object.freeze({
    subtle: Object.freeze(subtle),
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      assertOpen();
      if (!(array instanceof Int8Array || array instanceof Uint8Array || array instanceof Uint8ClampedArray ||
        array instanceof Int16Array || array instanceof Uint16Array || array instanceof Int32Array ||
        array instanceof Uint32Array ||
        (typeof BigInt64Array !== 'undefined' && array instanceof BigInt64Array) ||
        (typeof BigUint64Array !== 'undefined' && array instanceof BigUint64Array)) ||
        !(array.buffer instanceof ArrayBuffer)) throw new TypeError('Expected an integer typed array');
      if (array.byteLength > 65_536) throw error('QuotaExceededError', 'Random request exceeds 65536 bytes');
      const random = nativeSync(() => context.randomBytes(array.byteLength));
      try {
        if (!(random instanceof Uint8Array) || random.length !== array.byteLength)
          throw error('NativeCryptoError', 'Invalid native random response');
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(random);
      } finally { if (random instanceof Uint8Array) random.fill(0); }
      return array;
    },
    randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
      const b = new Uint8Array(16);
      this.getRandomValues(b);
      b[6] = (b[6]! & 15) | 64; b[8] = (b[8]! & 63) | 128;
      const hex = Array.from(b, (value) => value.toString(16).padStart(2, '0')).join('');
      b.fill(0);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  }) as unknown as Crypto;
  providers.set(crypto, { close() { if (!closed) { closed = true; nativeSync(() => context.close()); } } });
  return crypto;
}

/** Fatal shutdown/tests only. A shared provider must not be closed per-wallet lock. */
export function disposeWalletCrypto(provider: Crypto): void {
  const entry = providers.get(provider);
  if (!entry) throw new TypeError('Unknown wallet crypto provider');
  entry.close();
}
