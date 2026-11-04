import { sha256 } from 'ethers/crypto';

import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';

import type {
  IEncryptedPrivateRecord,
  IKeyringManager,
} from '@sidhujag/sysweb3-keyring';

export const SLH_DSA_PROFILE_STATE_DOMAIN = 'org.syscoin.pali.slh-dsa-state.v1';
// Match the SDK private-record payload bound without loading its signer graph.
export const SLH_DSA_PROFILE_STATE_MAX_BYTES = 64 * 1024;
const MAX_CIPHERTEXT_CHARS =
  Math.ceil((SLH_DSA_PROFILE_STATE_MAX_BYTES + 16) / 3) * 4;
const MAX_ENVELOPE_CHARS = MAX_CIPHERTEXT_CHARS + 1024;
const encoder = new TextEncoder();

export type SlhDsaStateCrypto = Readonly<{
  decrypt(cipherText: string, keyId: string): Promise<string> | string;
  encrypt(plainText: string, keyId: string): Promise<string> | string;
}>;
type ProfileCrypto = Pick<
  IKeyringManager,
  'encryptPrivateRecord' | 'decryptPrivateRecord'
>;
const invalid = (): never => {
  throw new Error('SLH_DSA_PROFILE_STATE_INVALID');
};
function recordId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > SLH_DSA_PROFILE_STATE_MAX_BYTES ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
  )
    return invalid();
  // Existing padded public key IDs exceed the SDK label limit. Bind the full
  // identifier without truncating it or changing the actual signer identity.
  return sha256(encoder.encode(value));
}
function current(check: () => void): void {
  const result: unknown = check();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    throw new Error('SLH_DSA_PROFILE_STATE_SESSION_CHANGED');
  }
}
function snapshotEnvelope(
  input: unknown,
  expectedKey: string
): IEncryptedPrivateRecord {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    return invalid();
  const names = [
    'version',
    'profileId',
    'domain',
    'recordId',
    'nonce',
    'ciphertext',
  ];
  const own = Reflect.ownKeys(input);
  if (
    own.length !== names.length ||
    own.some((name) => typeof name !== 'string' || !names.includes(name))
  )
    return invalid();
  const values: Record<string, unknown> = {};
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(input, name);
    if (!field || !field.enumerable || !('value' in field)) return invalid();
    values[name] = field.value;
  }
  if (
    values.version !== 1 ||
    values.domain !== SLH_DSA_PROFILE_STATE_DOMAIN ||
    values.recordId !== expectedKey ||
    typeof values.profileId !== 'string' ||
    !/^0x[0-9a-f]{64}$/.test(values.profileId) ||
    typeof values.nonce !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(values.nonce) ||
    typeof values.ciphertext !== 'string' ||
    values.ciphertext.length < 24 ||
    values.ciphertext.length > MAX_CIPHERTEXT_CHARS ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      values.ciphertext
    )
  )
    return invalid();
  return Object.freeze(values) as unknown as IEncryptedPrivateRecord;
}
function decodeEnvelope(
  raw: string,
  expectedKey: string
): IEncryptedPrivateRecord {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_ENVELOPE_CHARS)
    return invalid();
  assertJsonTextBudget(raw, {
    depth: 2,
    nodes: 8,
    tokenCharacters: MAX_CIPHERTEXT_CHARS,
  });
  const envelope = snapshotEnvelope(JSON.parse(raw), expectedKey);
  if (JSON.stringify(envelope) !== raw) return invalid();
  return envelope;
}

/** Complete opaque signer state; the caller retains the existing counter/schema policy. */
export function createSlhDsaProfileStateCrypto(
  keyring: ProfileCrypto,
  assertCurrent: () => void
): SlhDsaStateCrypto {
  current(assertCurrent);
  if (
    typeof keyring?.encryptPrivateRecord !== 'function' ||
    typeof keyring?.decryptPrivateRecord !== 'function'
  )
    throw new Error('SDK profile-state encryption is unavailable');
  const encrypt = keyring.encryptPrivateRecord.bind(keyring);
  const decrypt = keyring.decryptPrivateRecord.bind(keyring);
  return Object.freeze({
    async encrypt(plainText: string, requestedKey: string): Promise<string> {
      current(assertCurrent);
      const expectedKey = recordId(requestedKey);
      if (
        typeof plainText !== 'string' ||
        !plainText ||
        !plainText.isWellFormed() ||
        plainText.length > SLH_DSA_PROFILE_STATE_MAX_BYTES
      )
        return invalid();
      const bytes = encoder.encode(plainText);
      try {
        if (bytes.length > SLH_DSA_PROFILE_STATE_MAX_BYTES) return invalid();
        const encrypted = await encrypt({
          domain: SLH_DSA_PROFILE_STATE_DOMAIN,
          recordId: expectedKey,
          plaintext: bytes,
        });
        current(assertCurrent);
        return JSON.stringify(snapshotEnvelope(encrypted, expectedKey));
      } finally {
        bytes.fill(0);
      }
    },
    async decrypt(cipherText: string, requestedKey: string): Promise<string> {
      current(assertCurrent);
      const expectedKey = recordId(requestedKey);
      const envelope = decodeEnvelope(cipherText, expectedKey);
      const bytes = await decrypt({
        domain: SLH_DSA_PROFILE_STATE_DOMAIN,
        recordId: expectedKey,
        envelope,
      });
      try {
        current(assertCurrent);
        if (
          !(bytes instanceof Uint8Array) ||
          !bytes.length ||
          bytes.length > SLH_DSA_PROFILE_STATE_MAX_BYTES
        )
          return invalid();
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } finally {
        if (bytes instanceof Uint8Array) bytes.fill(0);
      }
    },
  });
}
