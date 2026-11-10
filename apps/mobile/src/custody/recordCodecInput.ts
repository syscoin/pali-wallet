import { MAX_PRIVATE_RECORD_BYTES } from '@sidhujag/sysweb3-keyring/cjs/private-records.js';
import type { IDecryptPrivateRecordParams, IEncryptPrivateRecordParams } from '@sidhujag/sysweb3-keyring';

const invalid = (): never => { throw new Error('INVALID_INPUT'); };
const own = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field || !('value' in field)) return invalid();
  return field.value;
};
const text = (value: unknown, maximum: number): string => typeof value === 'string' && value.length <= maximum ? value : invalid();
const scope = (input: unknown, domains: readonly string[]) => {
  const domain = text(own(input, 'domain'), 128), recordId = text(own(input, 'recordId'), 128);
  if (!domains.includes(domain)) return invalid();
  return { domain, recordId };
};

/** Snapshot before any OS/SDK await; no caller-owned bytes or getters cross the lease. */
export function snapshotRecordEncryption(input: IEncryptPrivateRecordParams, domains: readonly string[]): IEncryptPrivateRecordParams {
  const fields = scope(input, domains), plaintext = own(input, 'plaintext');
  if (!(plaintext instanceof Uint8Array) || plaintext.length > MAX_PRIVATE_RECORD_BYTES) return invalid();
  return Object.freeze({ ...fields, plaintext: new Uint8Array(plaintext) });
}
export function snapshotRecordDecryption(input: IDecryptPrivateRecordParams, domains: readonly string[]): IDecryptPrivateRecordParams {
  const fields = scope(input, domains), value = own(input, 'envelope');
  const envelope = Object.freeze({
    version: own(value, 'version'), domain: text(own(value, 'domain'), 128), recordId: text(own(value, 'recordId'), 128),
    profileId: text(own(value, 'profileId'), 128), nonce: text(own(value, 'nonce'), 128),
    ciphertext: text(own(value, 'ciphertext'), 2 * MAX_PRIVATE_RECORD_BYTES),
  });
  if (envelope.version !== 1 || envelope.domain !== fields.domain || envelope.recordId !== fields.recordId) return invalid();
  return Object.freeze({ ...fields, envelope: Object.freeze({ ...envelope, version: 1 as const }) });
}
