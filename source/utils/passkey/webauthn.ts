import { id as hashText } from '@ethersproject/hash';
import { toUtf8Bytes } from '@ethersproject/strings';

import { PasskeyBackupStatus } from 'types/network';

import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  hexToBytes,
} from './base64url';
import { asCborBytes, asCborMap, decodeCbor } from './cbor';
import { validatePasskeyClientDataJSON } from './validation';

export type PasskeyPublicKey = {
  backupStatus: PasskeyBackupStatus;
  credentialId: string;
  credentialIdHash: string;
  originHash: string;
  originLength: number;
  rpIdHash: string;
  x: string;
  y: string;
};

export type PasskeyRegistrationResult = PasskeyPublicKey & {
  rawId: string;
  userHandle: string;
};

export type PasskeyAssertionResult = {
  authenticatorData: string;
  backupStatus: PasskeyBackupStatus;
  challengeOffset: number;
  clientDataJSON: string;
  credentialId: string;
  credentialIdHash: string;
  digest: string;
  originOffset: number;
  publicKeyCandidates: Array<{
    originHash: string;
    originLength: number;
    rpIdHash: string;
    x: string;
    y: string;
  }>;
  r: string;
  s: string;
  typeOffset: number;
  userHandle?: string;
};

export type PasskeyCredentialRequest = {
  accountName: string;
  challengeHex: string;
  excludeCredentialIds?: string[];
  rpId?: string;
  rpName?: string;
  userDisplayName?: string;
  userId?: Uint8Array;
};

const ES256_ALGORITHM = -7;
const P256_CRV = 1;
const AUTH_DATA_FIXED_LENGTH = 37;
const ATTESTED_CREDENTIAL_DATA_FLAG = 0x40;
const BACKUP_ELIGIBLE_FLAG = 0x08;
const BACKUP_STATE_FLAG = 0x10;
const P256_N = BigInt(
  '0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'
);
const P256_P = BigInt(
  '0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'
);
const P256_B = BigInt(
  '0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'
);
const P256_GX = BigInt(
  '0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'
);
const P256_GY = BigInt(
  '0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'
);
const P256_HALF_N = BigInt(
  '0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8'
);

type P256Point = { x: bigint; y: bigint };

const sha256 = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(data)));

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

const toBytes = (value: ArrayBuffer): Uint8Array => new Uint8Array(value);

const bytesToBigInt = (bytes: Uint8Array): bigint =>
  BigInt(`0x${bytesToHex(bytes).slice(2) || '0'}`);

const bigIntToBytes32 = (value: bigint): Uint8Array => {
  const hex = value.toString(16).padStart(64, '0');
  return hexToBytes(`0x${hex}`);
};

const mod = (value: bigint, modulus: bigint): bigint => {
  const result = value % modulus;
  return result >= BigInt(0) ? result : result + modulus;
};

const modPow = (base: bigint, exponent: bigint, modulus: bigint): bigint => {
  let result = BigInt(1);
  let current = mod(base, modulus);
  let remaining = exponent;

  while (remaining > BigInt(0)) {
    if (remaining & BigInt(1)) {
      result = mod(result * current, modulus);
    }
    current = mod(current * current, modulus);
    remaining >>= BigInt(1);
  }

  return result;
};

const modInverse = (value: bigint, modulus: bigint): bigint =>
  modPow(value, modulus - BigInt(2), modulus);

const p256PointFromX = (x: bigint, oddY: boolean): P256Point | null => {
  if (x >= P256_P) {
    return null;
  }

  const ySquared = mod(x * x * x - BigInt(3) * x + P256_B, P256_P);
  let y = modPow(ySquared, (P256_P + BigInt(1)) / BigInt(4), P256_P);
  if (mod(y * y, P256_P) !== ySquared) {
    return null;
  }
  if (Boolean(y & BigInt(1)) !== oddY) {
    y = mod(-y, P256_P);
  }

  return { x, y };
};

const p256PointAdd = (
  left: P256Point | null,
  right: P256Point | null
): P256Point | null => {
  if (!left) return right;
  if (!right) return left;

  if (left.x === right.x) {
    if (mod(left.y + right.y, P256_P) === BigInt(0)) {
      return null;
    }
    const slope = mod(
      (BigInt(3) * left.x * left.x - BigInt(3)) *
        modInverse(BigInt(2) * left.y, P256_P),
      P256_P
    );
    const x = mod(slope * slope - BigInt(2) * left.x, P256_P);
    return { x, y: mod(slope * (left.x - x) - left.y, P256_P) };
  }

  const slope = mod(
    (right.y - left.y) * modInverse(right.x - left.x, P256_P),
    P256_P
  );
  const x = mod(slope * slope - left.x - right.x, P256_P);
  return { x, y: mod(slope * (left.x - x) - left.y, P256_P) };
};

const p256PointMultiply = (
  scalar: bigint,
  point: P256Point | null
): P256Point | null => {
  let result: P256Point | null = null;
  let addend = point;
  let remaining = mod(scalar, P256_N);

  while (remaining > BigInt(0)) {
    if (remaining & BigInt(1)) {
      result = p256PointAdd(result, addend);
    }
    addend = p256PointAdd(addend, addend);
    remaining >>= BigInt(1);
  }

  return result;
};

const normalizeP256S = (s: Uint8Array): Uint8Array => {
  const value = bytesToBigInt(s);
  if (value > P256_HALF_N) {
    return bigIntToBytes32(P256_N - value);
  }

  return s;
};

export const recoverP256PublicKeyCandidates = ({
  digest,
  originHash,
  originLength,
  r,
  rpIdHash,
  s,
}: {
  digest: Uint8Array;
  originHash: string;
  originLength: number;
  r: Uint8Array;
  rpIdHash: string;
  s: Uint8Array;
}): PasskeyAssertionResult['publicKeyCandidates'] => {
  const candidates = new Map<
    string,
    PasskeyAssertionResult['publicKeyCandidates'][number]
  >();
  const rValue = bytesToBigInt(r);
  const sValue = bytesToBigInt(normalizeP256S(s));
  if (
    rValue <= BigInt(0) ||
    rValue >= P256_N ||
    sValue <= BigInt(0) ||
    sValue > P256_HALF_N
  ) {
    return [];
  }
  const digestValue = mod(bytesToBigInt(digest), P256_N);
  const rInverse = modInverse(rValue, P256_N);
  const generator = { x: P256_GX, y: P256_GY };

  for (let recoveryBit = 0; recoveryBit < 4; recoveryBit += 1) {
    const x = rValue + BigInt(recoveryBit >> 1) * P256_N;
    const rPoint = p256PointFromX(x, Boolean(recoveryBit & 1));
    if (!rPoint) {
      continue;
    }

    const sR = p256PointMultiply(sValue, rPoint);
    const eG = p256PointMultiply(digestValue, generator);
    const recovered = p256PointMultiply(
      rInverse,
      p256PointAdd(sR, eG ? { x: eG.x, y: mod(-eG.y, P256_P) } : null)
    );
    if (!recovered) {
      continue;
    }

    const passkeyX = bytesToHex(bigIntToBytes32(recovered.x));
    const passkeyY = bytesToHex(bigIntToBytes32(recovered.y));
    candidates.set(`${passkeyX}:${passkeyY}`, {
      originHash,
      originLength,
      rpIdHash,
      x: passkeyX,
      y: passkeyY,
    });
  }

  return Array.from(candidates.values());
};

const getClientDataOrigin = (
  clientDataJSON: Uint8Array,
  originOffset: number
): string => {
  let end = originOffset;
  while (end < clientDataJSON.length && clientDataJSON[end] !== 0x22) {
    end += 1;
  }
  if (end >= clientDataJSON.length) {
    throw new Error('WebAuthn origin is missing a closing quote');
  }

  return new TextDecoder().decode(clientDataJSON.slice(originOffset, end));
};

export const getPasskeyBackupStatus = (
  authenticatorData: Uint8Array
): PasskeyBackupStatus => {
  if (authenticatorData.length <= 32) {
    return PasskeyBackupStatus.Unavailable;
  }

  const flags = authenticatorData[32];
  const backupEligible = (flags & BACKUP_ELIGIBLE_FLAG) !== 0;
  const backedUp = (flags & BACKUP_STATE_FLAG) !== 0;

  if (backupEligible && backedUp) {
    return PasskeyBackupStatus.Synced;
  }
  if (backupEligible) {
    return PasskeyBackupStatus.BackupCapable;
  }
  return PasskeyBackupStatus.DeviceBound;
};

const parseDerSignature = (signature: Uint8Array) => {
  if (signature[0] !== 0x30) throw new Error('Invalid DER signature');
  let offset = 2;

  if (signature[1] & 0x80) {
    offset = 2 + (signature[1] & 0x7f);
  }

  const readInteger = () => {
    if (signature[offset] !== 0x02)
      throw new Error('Invalid DER signature integer');
    const length = signature[offset + 1];
    offset += 2;
    let value = signature.slice(offset, offset + length);
    offset += length;

    while (value.length > 32 && value[0] === 0) {
      value = value.slice(1);
    }
    if (value.length > 32)
      throw new Error('Invalid P-256 signature integer length');

    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };

  return { r: readInteger(), s: normalizeP256S(readInteger()) };
};

const extractCredentialPublicKey = async (
  attestationObject: Uint8Array,
  expectedOrigin: string
): Promise<PasskeyPublicKey> => {
  const attestation = asCborMap(decodeCbor(attestationObject).value);
  const authData = asCborBytes(attestation.get('authData'));

  if (
    authData.length < AUTH_DATA_FIXED_LENGTH ||
    (authData[32] & ATTESTED_CREDENTIAL_DATA_FLAG) === 0
  ) {
    throw new Error('Authenticator did not return attested credential data');
  }

  let offset = AUTH_DATA_FIXED_LENGTH + 16; // rpIdHash + flags + signCount + AAGUID
  const credentialIdLength = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;

  const credentialIdBytes = authData.slice(offset, offset + credentialIdLength);
  offset += credentialIdLength;

  const coseKey = asCborMap(decodeCbor(authData, offset).value);
  const alg = coseKey.get(3);
  const crv = coseKey.get(-1);
  const x = asCborBytes(coseKey.get(-2));
  const y = asCborBytes(coseKey.get(-3));

  if (
    alg !== ES256_ALGORITHM ||
    crv !== P256_CRV ||
    x.length !== 32 ||
    y.length !== 32
  ) {
    throw new Error('Passkey must use ES256 / P-256');
  }

  const credentialIdHash = await sha256(credentialIdBytes);
  const rpIdHash = authData.slice(0, 32);

  return {
    backupStatus: getPasskeyBackupStatus(authData),
    credentialId: bytesToBase64Url(credentialIdBytes),
    credentialIdHash: bytesToHex(credentialIdHash),
    originHash: hashText(expectedOrigin),
    originLength: toUtf8Bytes(expectedOrigin).length,
    rpIdHash: bytesToHex(rpIdHash),
    x: bytesToHex(x),
    y: bytesToHex(y),
  };
};

export const createPasskeyCredential = async ({
  accountName,
  challengeHex,
  excludeCredentialIds,
  rpId,
  rpName = 'Pali Wallet',
  userDisplayName,
  userId,
}: PasskeyCredentialRequest): Promise<PasskeyRegistrationResult> => {
  const challenge = hexToBytes(challengeHex);
  const userIdBytes = userId || crypto.getRandomValues(new Uint8Array(32));
  const excludeCredentials = (excludeCredentialIds || []).map(
    (credentialId) => ({
      id: toArrayBuffer(base64UrlToBytes(credentialId)),
      type: 'public-key' as const,
    })
  );
  const credential = (await navigator.credentials.create({
    publicKey: {
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      challenge: toArrayBuffer(challenge),
      ...(excludeCredentials.length ? { excludeCredentials } : {}),
      pubKeyCredParams: [{ type: 'public-key', alg: ES256_ALGORITHM }],
      rp: {
        name: rpName,
        ...(rpId ? { id: rpId } : {}),
      },
      timeout: 120_000,
      user: {
        id: toArrayBuffer(userIdBytes),
        name: accountName,
        displayName: userDisplayName || accountName,
      },
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey creation was cancelled');
  const response = credential.response as AuthenticatorAttestationResponse;
  const expectedOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  if (!expectedOrigin) {
    throw new Error('WebAuthn origin is unavailable');
  }
  const publicKey = await extractCredentialPublicKey(
    toBytes(response.attestationObject),
    expectedOrigin
  );

  return {
    ...publicKey,
    rawId: bytesToBase64Url(toBytes(credential.rawId)),
    userHandle: bytesToBase64Url(userIdBytes),
  };
};

const getPasskeyAssertionForCredential = async (
  credentialId: string | undefined,
  challengeHex: string,
  rpId?: string
): Promise<PasskeyAssertionResult> => {
  const challenge = hexToBytes(challengeHex);
  const challengeText = bytesToBase64Url(challenge);
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      ...(credentialId
        ? {
            allowCredentials: [
              {
                id: toArrayBuffer(base64UrlToBytes(credentialId)),
                type: 'public-key' as const,
              },
            ],
          }
        : {}),
      ...(rpId ? { rpId } : {}),
      timeout: 120_000,
      userVerification: 'required',
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Passkey approval was cancelled');
  const response = credential.response as AuthenticatorAssertionResponse;
  const authenticatorData = toBytes(response.authenticatorData);
  const clientDataJSON = toBytes(response.clientDataJSON);
  const credentialIdBytes = toBytes(credential.rawId);
  const credentialIdHash = await sha256(credentialIdBytes);
  const signature = toBytes(response.signature);
  const expectedOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : undefined;
  const { challengeOffset, originOffset, typeOffset } =
    validatePasskeyClientDataJSON(
      clientDataJSON,
      challengeText,
      expectedOrigin
    );

  const clientDataHash = await sha256(clientDataJSON);
  const digest = await sha256(concatBytes(authenticatorData, clientDataHash));
  const { r, s } = parseDerSignature(signature);
  const origin = getClientDataOrigin(clientDataJSON, originOffset);
  const rpIdHash = bytesToHex(authenticatorData.slice(0, 32));
  const originLength = toUtf8Bytes(origin).length;
  const originHash = hashText(origin);
  const userHandle = response.userHandle
    ? bytesToBase64Url(toBytes(response.userHandle))
    : undefined;

  return {
    authenticatorData: bytesToHex(authenticatorData),
    backupStatus: getPasskeyBackupStatus(authenticatorData),
    challengeOffset,
    clientDataJSON: bytesToHex(clientDataJSON),
    credentialId: bytesToBase64Url(credentialIdBytes),
    credentialIdHash: bytesToHex(credentialIdHash),
    digest: bytesToHex(digest),
    originOffset,
    publicKeyCandidates: recoverP256PublicKeyCandidates({
      digest,
      originHash,
      originLength,
      r,
      rpIdHash,
      s,
    }),
    r: bytesToHex(r),
    s: bytesToHex(s),
    typeOffset,
    userHandle,
  };
};

export const getPasskeyAssertion = async (
  credentialId: string,
  challengeHex: string,
  rpId?: string
): Promise<PasskeyAssertionResult> =>
  getPasskeyAssertionForCredential(credentialId, challengeHex, rpId);

export const getDiscoverablePasskeyAssertion = async (
  challengeHex: string,
  rpId?: string
): Promise<PasskeyAssertionResult> =>
  getPasskeyAssertionForCredential(undefined, challengeHex, rpId);

// Stable user handle per smart account so that a re-created passkey for the
// same account replaces (instead of duplicating) the stale entry inside the
// same credential manager. Only safe when the previous passkey is no longer
// required to sign — callers must guarantee that.
export const derivePasskeyUserHandle = async (
  accountAddress: string
): Promise<Uint8Array> =>
  sha256(toUtf8Bytes(`pali:passkey:user:v1:${accountAddress.toLowerCase()}`));

const getDefaultRpId = (): string | undefined =>
  typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : undefined;

type SignalCapablePublicKeyCredential = typeof PublicKeyCredential & {
  signalAllAcceptedCredentials?: (options: {
    allAcceptedCredentialIds: string[];
    rpId: string;
    userId: string;
  }) => Promise<void>;
  signalUnknownCredential?: (options: {
    credentialId: string;
    rpId: string;
  }) => Promise<void>;
};

// Best-effort WebAuthn Signal API (Chrome/Edge 132+, Safari 26+). Lets the
// credential manager remove or hide passkeys the wallet no longer accepts.
// Never throws — callers treat cleanup as advisory.
export const signalUnknownPasskeyCredential = async (
  credentialId: string,
  rpId?: string
): Promise<boolean> => {
  try {
    const credentialApi =
      typeof PublicKeyCredential !== 'undefined'
        ? (PublicKeyCredential as SignalCapablePublicKeyCredential)
        : undefined;
    const resolvedRpId = rpId || getDefaultRpId();
    if (!credentialApi?.signalUnknownCredential || !resolvedRpId) {
      return false;
    }
    await credentialApi.signalUnknownCredential({
      credentialId,
      rpId: resolvedRpId,
    });
    return true;
  } catch {
    return false;
  }
};

export const signalAcceptedPasskeyCredentials = async ({
  credentialIds,
  rpId,
  userHandle,
}: {
  credentialIds: string[];
  rpId?: string;
  userHandle: string;
}): Promise<boolean> => {
  try {
    const credentialApi =
      typeof PublicKeyCredential !== 'undefined'
        ? (PublicKeyCredential as SignalCapablePublicKeyCredential)
        : undefined;
    const resolvedRpId = rpId || getDefaultRpId();
    if (!credentialApi?.signalAllAcceptedCredentials || !resolvedRpId) {
      return false;
    }
    await credentialApi.signalAllAcceptedCredentials({
      allAcceptedCredentialIds: credentialIds,
      rpId: resolvedRpId,
      userId: userHandle,
    });
    return true;
  } catch {
    return false;
  }
};

export type RecoveredPasskeyProfile = {
  backupStatus: PasskeyBackupStatus;
  credentialId: string;
  credentialIdHash: string;
  publicKey: {
    originHash: string;
    originLength: number;
    rpIdHash: string;
    x: string;
    y: string;
  };
  userHandle?: string;
};

const randomChallengeHex = (): string =>
  bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

export const intersectPasskeyPublicKeyCandidates = (
  first: PasskeyAssertionResult['publicKeyCandidates'],
  second: PasskeyAssertionResult['publicKeyCandidates']
): PasskeyAssertionResult['publicKeyCandidates'] =>
  first.filter((candidate) =>
    second.some(
      (other) =>
        other.x.toLowerCase() === candidate.x.toLowerCase() &&
        other.y.toLowerCase() === candidate.y.toLowerCase()
    )
  );

// Recovers the full P-256 public key of an EXISTING passkey without creating a
// new credential. WebAuthn assertions never return the public key directly,
// but ECDSA public key recovery from (r, s, digest) yields up to four
// candidates per signature:
// - when the expected public key is known (e.g. from on-chain authData), one
//   assertion suffices: we match it against the candidate set;
// - otherwise a second assertion over a different challenge is requested and
//   the candidate sets are intersected, which uniquely identifies the key.
export const recoverExistingPasskeyProfile = async ({
  expectedCredentialIdHash,
  expectedPublicKey,
  rpId,
}: {
  expectedCredentialIdHash?: string;
  expectedPublicKey?: { x: string; y: string };
  rpId?: string;
} = {}): Promise<RecoveredPasskeyProfile> => {
  const firstAssertion = await getDiscoverablePasskeyAssertion(
    randomChallengeHex(),
    rpId
  );
  if (
    expectedCredentialIdHash &&
    firstAssertion.credentialIdHash.toLowerCase() !==
      expectedCredentialIdHash.toLowerCase()
  ) {
    throw new Error('Selected passkey does not match this smart account');
  }

  let candidates = firstAssertion.publicKeyCandidates;
  if (expectedPublicKey) {
    candidates = candidates.filter(
      (candidate) =>
        candidate.x.toLowerCase() === expectedPublicKey.x.toLowerCase() &&
        candidate.y.toLowerCase() === expectedPublicKey.y.toLowerCase()
    );
    if (candidates.length !== 1) {
      throw new Error(
        'Selected passkey public key does not match this smart account'
      );
    }
  } else {
    const secondAssertion = await getPasskeyAssertion(
      firstAssertion.credentialId,
      randomChallengeHex(),
      rpId
    );
    if (
      secondAssertion.credentialIdHash.toLowerCase() !==
      firstAssertion.credentialIdHash.toLowerCase()
    ) {
      throw new Error('Passkey changed between confirmation prompts');
    }
    candidates = intersectPasskeyPublicKeyCandidates(
      candidates,
      secondAssertion.publicKeyCandidates
    );
    if (candidates.length !== 1) {
      throw new Error(
        'Could not uniquely recover the passkey public key. Please try again.'
      );
    }
  }

  const [publicKey] = candidates;
  return {
    backupStatus: firstAssertion.backupStatus,
    credentialId: firstAssertion.credentialId,
    credentialIdHash: firstAssertion.credentialIdHash,
    publicKey: {
      originHash: publicKey.originHash,
      originLength: publicKey.originLength,
      rpIdHash: publicKey.rpIdHash,
      x: publicKey.x,
      y: publicKey.y,
    },
    userHandle: firstAssertion.userHandle,
  };
};
