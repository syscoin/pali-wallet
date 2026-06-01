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
};

export type PasskeyAssertionResult = {
  authenticatorData: string;
  challengeOffset: number;
  clientDataJSON: string;
  credentialId: string;
  credentialIdHash: string;
  digest: string;
  originOffset: number;
  r: string;
  s: string;
  typeOffset: number;
};

export type PasskeyCredentialRequest = {
  accountName: string;
  challengeHex: string;
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
const P256_HALF_N = BigInt(
  '0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8'
);

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

const normalizeP256S = (s: Uint8Array): Uint8Array => {
  const value = bytesToBigInt(s);
  if (value > P256_HALF_N) {
    return bigIntToBytes32(P256_N - value);
  }

  return s;
};

const getPasskeyBackupStatus = (
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
  rpId,
  rpName = 'Pali Wallet',
  userDisplayName,
  userId,
}: PasskeyCredentialRequest): Promise<PasskeyRegistrationResult> => {
  const challenge = hexToBytes(challengeHex);
  const userIdBytes = userId || crypto.getRandomValues(new Uint8Array(32));
  const credential = (await navigator.credentials.create({
    publicKey: {
      attestation: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      challenge: toArrayBuffer(challenge),
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

  return {
    authenticatorData: bytesToHex(authenticatorData),
    challengeOffset,
    clientDataJSON: bytesToHex(clientDataJSON),
    credentialId: bytesToBase64Url(credentialIdBytes),
    credentialIdHash: bytesToHex(credentialIdHash),
    digest: bytesToHex(digest),
    originOffset,
    r: bytesToHex(r),
    s: bytesToHex(s),
    typeOffset,
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
