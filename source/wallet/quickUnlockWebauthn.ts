import { bytesToBase64Url } from '../utils/passkey/base64url.ts';
import {
  readPasskeyClientDataJSON,
  type PasskeyClientDataType,
} from '../utils/passkey/clientData.ts';
import { parseP256DerSignature } from '../utils/passkey/p256Signature.ts';

type Bytes = Uint8Array<ArrayBuffer>;
type InputBytes = ArrayBuffer | Bytes;

export type QuickUnlockWebAuthnExpectation = Readonly<{
  challenge: InputBytes;
  origin: string;
  /** The effective RP ID, including the serialized origin for Chromium extensions. */
  rpId: string;
}> &
  Readonly<
    | { credentialId?: InputBytes; type: 'webauthn.create' }
    | { credentialId: InputBytes; type: 'webauthn.get' }
  >;

/** The private host snapshots its direct browser credential for the requested ceremony and PRF salt. */
export type QuickUnlockWebAuthnResponse = Readonly<{
  authenticatorData: InputBytes;
  clientDataJSON: InputBytes;
  prfEnabled?: boolean;
  prfOutput?: InputBytes;
  rawId: InputBytes;
  signature?: InputBytes;
  type: 'public-key';
}>;

export type AdmittedQuickUnlockWebAuthnResponse = Readonly<{
  authenticatorData: Bytes;
  clientDataJSON: Bytes;
  credentialId: Bytes;
}> &
  Readonly<
    | {
        kind: 'registration-needs-assertion';
        prf: 'not-returned' | 'returned';
      }
    | {
        kind: 'assertion-needs-signature-verification';
        prfOutput: Bytes;
        signature: Bytes;
      }
  >;

const MAX_CREDENTIAL_BYTES = 1023;
const MAX_RESPONSE_BYTES = 4096;
const AUTHENTICATOR_DATA_HEADER_BYTES = 37;
const UP_AND_UV = 0x05;
const BACKUP_ELIGIBLE = 0x08;
const BACKED_UP = 0x10;
const ATTESTED = 0x40;
const EXTENSION_DATA = 0x80;
const ATTESTED_ID_OFFSET = AUTHENTICATOR_DATA_HEADER_BYTES + 16 + 2;
const invalid = () => new Error('Invalid Quick unlock WebAuthn response');

const equal = (left: Bytes, right: Bytes) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function own<T extends object, K extends keyof T>(
  value: T,
  key: K
): T[K] | undefined {
  const property = Object.getOwnPropertyDescriptor(value, key);
  if (property && !('value' in property)) throw invalid();
  return property?.value;
}

function copyBytes(
  value: unknown,
  min: number,
  max = min,
  owned?: Bytes[]
): Bytes {
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
  const copy = new Uint8Array(view);
  owned?.push(copy);
  return copy;
}

function isScope(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[^\x21-\x7e]/.test(value)
  );
}

function checkOwner(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).catch(() => undefined);
  throw invalid();
}

function admitClientData(
  bytes: Bytes,
  type: PasskeyClientDataType,
  challenge: Bytes,
  origin: string
) {
  try {
    readPasskeyClientDataJSON(bytes, type, bytesToBase64Url(challenge), origin);
  } catch {
    throw invalid();
  }
}

function admitAuthenticatorData(data: Bytes, id: Bytes, create: boolean): void {
  const flags = data[32]!;
  const hasExtensionBytes = data.length > AUTHENTICATOR_DATA_HEADER_BYTES;
  if (
    (flags & UP_AND_UV) !== UP_AND_UV ||
    !!(flags & ATTESTED) !== create ||
    ((flags & BACKED_UP) !== 0 && (flags & BACKUP_ELIGIBLE) === 0) ||
    (!create && !!(flags & EXTENSION_DATA) !== hasExtensionBytes)
  )
    throw invalid();
  if (create) {
    if (data.length <= ATTESTED_ID_OFFSET) throw invalid();
    const size =
      (data[ATTESTED_ID_OFFSET - 2]! << 8) | data[ATTESTED_ID_OFFSET - 1]!;
    const end = ATTESTED_ID_OFFSET + size;
    if (
      end >= data.length ||
      !equal(id, data.subarray(ATTESTED_ID_OFFSET, end))
    )
      throw invalid();
  }
}

function captureResponse(
  expected: QuickUnlockWebAuthnExpectation,
  response: QuickUnlockWebAuthnResponse,
  owned?: Bytes[]
) {
  if (
    !expected ||
    typeof expected !== 'object' ||
    !response ||
    typeof response !== 'object'
  )
    throw invalid();
  const type = own(expected, 'type');
  const create = type === 'webauthn.create';
  const origin = own(expected, 'origin');
  const rpId = own(expected, 'rpId');
  if (
    (!create && type !== 'webauthn.get') ||
    own(response, 'type') !== 'public-key' ||
    !isScope(origin, 512) ||
    !isScope(rpId, 253)
  )
    throw invalid();
  const challenge = copyBytes(own(expected, 'challenge'), 32, 32, owned);
  const expectedId = own(expected, 'credentialId');
  const credentialId = copyBytes(
    own(response, 'rawId'),
    1,
    MAX_CREDENTIAL_BYTES,
    owned
  );
  if (
    (!create || expectedId !== undefined) &&
    !equal(credentialId, copyBytes(expectedId, 1, MAX_CREDENTIAL_BYTES, owned))
  )
    throw invalid();
  const clientDataJSON = copyBytes(
    own(response, 'clientDataJSON'),
    1,
    MAX_RESPONSE_BYTES,
    owned
  );
  const authenticatorData = copyBytes(
    own(response, 'authenticatorData'),
    AUTHENTICATOR_DATA_HEADER_BYTES,
    MAX_RESPONSE_BYTES,
    owned
  );
  const signature = create
    ? undefined
    : copyBytes(own(response, 'signature'), 1, 1024, owned);
  admitClientData(clientDataJSON, type, challenge, origin);
  admitAuthenticatorData(authenticatorData, credentialId, create);
  return {
    create,
    rpId,
    credentialId,
    clientDataJSON,
    authenticatorData,
    signature,
  };
}

async function runCrypto<T>(
  operation: () => Promise<T>,
  assertCurrent: () => void
): Promise<T> {
  checkOwner(assertCurrent);
  try {
    return await operation();
  } catch {
    checkOwner(assertCurrent);
    throw invalid();
  }
}

async function assertRpHash(
  rpId: string,
  authenticatorData: Bytes,
  assertCurrent: () => void,
  subtle: Pick<SubtleCrypto, 'digest'>
): Promise<void> {
  const scope = new TextEncoder().encode(rpId);
  try {
    const result = await runCrypto(
      () => subtle.digest('SHA-256', scope),
      assertCurrent
    );
    if (!(result instanceof ArrayBuffer)) throw invalid();
    const hash = new Uint8Array(result);
    try {
      checkOwner(assertCurrent);
      if (hash.length !== 32 || !equal(authenticatorData.subarray(0, 32), hash))
        throw invalid();
    } finally {
      hash.fill(0);
    }
  } finally {
    scope.fill(0);
  }
}

/** The owner verifies the admitted assertion signature and session before using its PRF output. */
export async function admitQuickUnlockWebAuthnResponse(
  expected: QuickUnlockWebAuthnExpectation,
  response: QuickUnlockWebAuthnResponse,
  assertCurrent: () => void,
  subtle: Pick<SubtleCrypto, 'digest'>
): Promise<AdmittedQuickUnlockWebAuthnResponse> {
  checkOwner(assertCurrent);
  const {
    create,
    rpId,
    credentialId,
    clientDataJSON,
    authenticatorData,
    signature,
  } = captureResponse(expected, response);
  const enabled = own(response, 'prfEnabled');
  const first = own(response, 'prfOutput');
  if ((create || enabled !== undefined) && enabled !== true) throw invalid();
  const prf = create && first === undefined ? undefined : copyBytes(first, 32);
  let delivered = false;
  try {
    await assertRpHash(rpId, authenticatorData, assertCurrent, subtle);
    checkOwner(assertCurrent);
    const bytes = { credentialId, clientDataJSON, authenticatorData };
    if (create)
      return Object.freeze({
        ...bytes,
        kind: 'registration-needs-assertion',
        prf: prf ? 'returned' : 'not-returned',
      });
    const result: AdmittedQuickUnlockWebAuthnResponse = Object.freeze({
      ...bytes,
      kind: 'assertion-needs-signature-verification',
      signature: signature!,
      prfOutput: prf!,
    });
    delivered = true;
    return result;
  } finally {
    if (!delivered) prf?.fill(0);
  }
}

type SignedResponse = Required<
  Pick<
    QuickUnlockWebAuthnResponse,
    'type' | 'rawId' | 'authenticatorData' | 'clientDataJSON' | 'signature'
  >
>;

type AssertionExpectation = Extract<
  QuickUnlockWebAuthnExpectation,
  { type: 'webauthn.get' }
>;

/** Verifies the signed assertion only. The host owns session and direct PRF provenance. */
export async function verifyQuickUnlockEs256Assertion(
  expected: AssertionExpectation,
  response: SignedResponse,
  enrolledSpki: InputBytes,
  assertCurrent: () => void,
  subtle: Pick<SubtleCrypto, 'digest' | 'importKey' | 'verify'>
): Promise<void> {
  checkOwner(assertCurrent);
  const owned: Bytes[] = [];
  try {
    const { create, rpId, clientDataJSON, authenticatorData, signature } =
      captureResponse(expected, response, owned);
    if (create || !signature) throw invalid();
    const raw = parseP256DerSignature(signature);
    owned.push(raw);
    const spki = copyBytes(enrolledSpki, 3, 129, owned);
    // A named P-256 SPKI fits short-form DER. Reject an appended suffix
    // even when the underlying WebCrypto implementation ignores it.
    if (spki[0] !== 0x30 || spki[1] !== spki.length - 2) throw invalid();

    await assertRpHash(rpId, authenticatorData, assertCurrent, subtle);
    const key = await runCrypto(
      () =>
        subtle.importKey(
          'spki',
          spki,
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify']
        ),
      assertCurrent
    );
    const digest = await runCrypto(
      () => subtle.digest('SHA-256', clientDataJSON),
      assertCurrent
    );
    if (!(digest instanceof ArrayBuffer)) throw invalid();
    const hash = new Uint8Array(digest);
    owned.push(hash);
    checkOwner(assertCurrent);
    if (hash.length !== 32) throw invalid();
    const message = new Uint8Array(authenticatorData.length + hash.length);
    owned.push(message);
    message.set(authenticatorData);
    message.set(hash, authenticatorData.length);
    const verified = await runCrypto(
      () =>
        subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, message),
      assertCurrent
    );
    checkOwner(assertCurrent);
    if (verified !== true) throw invalid();
  } finally {
    for (const bytes of owned) bytes.fill(0);
  }
}
