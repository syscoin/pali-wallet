const DOMAIN = 'org.syscoin.pali.quick-unlock.v1';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const CIPHERTEXT_BYTES = KEY_BYTES + 16;
const ENVELOPE_LENGTH = 4 + 2 * (NONCE_BYTES + CIPHERTEXT_BYTES);
const MAX_CREDENTIAL_BYTES = 1023;
const utf8 = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;
type InputBytes = Bytes | ArrayBuffer;
type QuickUnlockCrypto = Pick<Crypto, 'getRandomValues' | 'subtle'>;

/** The caller supplies this scope from the current local owner and verified credential. */
export type QuickUnlockScope = Readonly<{
  credentialId: InputBytes;
  enrollmentId: string;
  installationId: string;
  pairFingerprint: string;
  prfSalt: InputBytes;
  profileId: string;
  rpId: string;
}>;

/** Canonical version, 12-byte nonce and 48-byte ciphertext with its GCM tag. */
export type QuickUnlockEnvelope = `v1:${string}:${string}`;

const invalid = () => new Error('Invalid quick unlock wrapping input');
const hex = (bytes: Bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) =>
  Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));

function byteView(value: unknown, min: number, max = min): Bytes {
  let view: Bytes;
  if (value instanceof ArrayBuffer) view = new Uint8Array(value);
  else if (
    value instanceof Uint8Array &&
    ArrayBuffer.isView(value) &&
    value.buffer instanceof ArrayBuffer
  )
    view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else throw invalid();
  if (view.byteLength < min || view.byteLength > max) throw invalid();
  return view;
}

const opaqueId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 128 &&
  /^[A-Za-z0-9._:-]+$/.test(value);

const rpScope = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 253 &&
  // Chromium hashes the serialized extension origin as its default RP ID.
  (/^chrome-extension:\/\/[a-p]{32}$/.test(value) ||
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
      value
    ));

function captureScope(scope: QuickUnlockScope) {
  const fields = [
    'installationId',
    'profileId',
    'pairFingerprint',
    'enrollmentId',
    'rpId',
    'credentialId',
    'prfSalt',
  ] as const;
  const [installation, profile, pair, enrollment, rpId, credential, prfSalt] =
    fields.map((field): unknown => {
      const property = Object.getOwnPropertyDescriptor(scope, field);
      if (!property || !('value' in property)) throw invalid();
      return property.value;
    });
  if (
    !opaqueId(installation) ||
    !opaqueId(profile) ||
    !opaqueId(enrollment) ||
    typeof pair !== 'string' ||
    !/^[0-9a-f]{64}$/.test(pair) ||
    !rpScope(rpId)
  )
    throw invalid();
  const credentialHex = hex(byteView(credential, 1, MAX_CREDENTIAL_BYTES));
  const salt = new Uint8Array(byteView(prfSalt, KEY_BYTES));
  const localScope = [DOMAIN, installation, profile, pair, enrollment, rpId];
  // Keep HKDF info below 1 KiB even for long credential IDs. GCM binds the
  // complete ordered scope, including the credential and exact PRF salt.
  const info = utf8.encode(JSON.stringify(localScope));
  const aad = utf8.encode(
    JSON.stringify([...localScope, credentialHex, hex(salt)])
  );
  return { salt, info, aad };
}

function checkOwner(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).catch(() => undefined);
  throw new Error('Quick unlock requires a synchronous owner guard');
}

async function crypt<T>(
  scope: QuickUnlockScope,
  prfOutput: InputBytes,
  assertCurrent: () => void,
  crypto: QuickUnlockCrypto,
  usage: 'encrypt' | 'decrypt',
  readInput: () => { data: Bytes; iv: Bytes },
  deliver: (iv: Bytes, output: Bytes) => T
): Promise<T> {
  const temporary: Bytes[] = [];
  const own = (bytes: Bytes) => {
    temporary.push(bytes);
    return bytes;
  };
  const rejected = (error: unknown): never => {
    checkOwner(assertCurrent);
    throw error;
  };
  try {
    checkOwner(assertCurrent);
    const { salt, info, aad } = captureScope(scope);
    temporary.push(salt, info, aad);
    const { iv, data } = readInput();
    temporary.push(iv, data);
    const ikm = own(new Uint8Array(byteView(prfOutput, KEY_BYTES)));
    const { subtle } = crypto;
    if (usage === 'encrypt' && crypto.getRandomValues(iv) !== iv)
      throw invalid();
    checkOwner(assertCurrent);
    const material = await subtle
      .importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
      .catch(rejected);
    ikm.fill(0);
    checkOwner(assertCurrent);
    const key = await subtle
      .deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        [usage]
      )
      .catch(rejected);
    checkOwner(assertCurrent);
    const params = {
      name: 'AES-GCM',
      iv,
      additionalData: aad,
      tagLength: 128,
    };
    const output = own(
      new Uint8Array(await subtle[usage](params, key, data).catch(rejected))
    );
    checkOwner(assertCurrent);
    if (output.length !== (usage === 'encrypt' ? CIPHERTEXT_BYTES : KEY_BYTES))
      throw invalid();
    return deliver(iv, output);
  } finally {
    for (const bytes of temporary) bytes.fill(0);
  }
}

/** Wrap an already-derived vault key. The caller retains ownership of its inputs. */
export function wrapQuickUnlockKey(
  scope: QuickUnlockScope,
  prfOutput: InputBytes,
  vaultKey: InputBytes,
  assertCurrent: () => void,
  crypto: QuickUnlockCrypto
): Promise<QuickUnlockEnvelope> {
  return crypt<QuickUnlockEnvelope>(
    scope,
    prfOutput,
    assertCurrent,
    crypto,
    'encrypt',
    () => ({
      iv: new Uint8Array(NONCE_BYTES),
      data: new Uint8Array(byteView(vaultKey, KEY_BYTES)),
    }),
    (iv, ciphertext) => `v1:${hex(iv)}:${hex(ciphertext)}`
  );
}

/** Return a caller-owned 32-byte key only after authentication and the final guard. */
export function unwrapQuickUnlockKey(
  scope: QuickUnlockScope,
  prfOutput: InputBytes,
  envelope: unknown,
  assertCurrent: () => void,
  crypto: QuickUnlockCrypto
): Promise<Bytes> {
  return crypt(
    scope,
    prfOutput,
    assertCurrent,
    crypto,
    'decrypt',
    () => {
      const match =
        typeof envelope === 'string' &&
        envelope.length === ENVELOPE_LENGTH &&
        /^v1:([0-9a-f]{24}):([0-9a-f]{96})$/.exec(envelope);
      if (!match) throw invalid();
      return { iv: unhex(match[1]!), data: unhex(match[2]!) };
    },
    (_iv, key) => new Uint8Array(key)
  );
}
