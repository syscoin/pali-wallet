import { sha256 } from 'ethers/crypto';

import { assertJsonTextBudget } from '../shared/jsonTextBudget.ts';
import { PSBT_WORK_LIMITS } from '../utils/psbtWorkBudget.ts';

import type { IEncryptedPrivateRecord } from '@sidhujag/sysweb3-keyring';

export const UTXO_SIGNED_RECORD_PREFIX = 'pali-utxo-signed-v1:';
export const UTXO_SIGNED_RECORD_KEY = 'pali.utxo.signed.records';
export const UTXO_SIGNED_RECORD_BYTES = 16 * 1024 * 1024;
export const MAX_RECORDS = 4096;
export const CHUNK_BYTES = 48 * 1024;
export const RAW_BYTES = PSBT_WORK_LIMITS.bytes;
export const ROOT_DOMAIN = 'org.syscoin.pali.utxo.signed.root.v1';
export const CHUNK_DOMAIN = 'org.syscoin.pali.utxo.signed.chunk.v1';
export const PROFILE = /^0x[0-9a-f]{64}$/;
export const HASH = /^[0-9a-f]{64}$/;
const OUTPOINT = /^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$/;
const encoder = new TextEncoder();

export type Summary = Readonly<{
  chain: string;
  key: string;
  outpoints: readonly string[];
  owner: string;
  phase: 'pending' | 'submitted' | 'confirmed';
  txid: string;
}>;
export type Entry = Summary &
  Readonly<{ chunks: readonly IEncryptedPrivateRecord[] }>;
export type Bundle = Readonly<{
  entries: readonly Entry[];
  profileId: string;
  revision: number;
  root: IEncryptedPrivateRecord;
  version: 1;
}>;

export const corrupt = (): never => {
  throw new Error('UTXO_SIGNED_RECORD_CORRUPT');
};
export const capacity = (): never => {
  throw new Error('UTXO_SIGNED_RECORD_CAPACITY');
};
export const digest = (value: unknown): string =>
  sha256(encoder.encode(JSON.stringify(value)));
export const entriesDigest = (entries: readonly Entry[]): string =>
  digest(entries.map((entry) => digest(entry)));
export const recordKey = (chain: string, txid: string) => {
  if (typeof txid !== 'string' || !HASH.test(txid)) return corrupt();
  return digest([chain, txid]).slice(2);
};

export function validOutpoints(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= PSBT_WORK_LIMITS.inputs &&
    value.every(
      (entry) =>
        typeof entry === 'string' &&
        OUTPOINT.test(entry) &&
        Number(entry.slice(65)) <= 0xffffffff
    ) &&
    new Set(value).size === value.length
  );
}

export function validUtxoEnvelope(
  value: any,
  profileId: string,
  domain: string,
  recordId: string
): boolean {
  return (
    !!value &&
    Object.keys(value).length === 6 &&
    value.version === 1 &&
    value.profileId === profileId &&
    value.domain === domain &&
    value.recordId === recordId &&
    typeof value.nonce === 'string' &&
    /^[A-Za-z0-9+/]{16}$/.test(value.nonce) &&
    typeof value.ciphertext === 'string' &&
    value.ciphertext.length >= 24 &&
    value.ciphertext.length <= Math.ceil((CHUNK_BYTES + 16) / 3) * 4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.ciphertext
    )
  );
}

/** Structural admission for host storage. The owner authenticates the root before use. */
export function inspectUtxoSignedBundle(
  raw: string,
  profileId: string
): Bundle {
  if (typeof raw !== 'string' || raw.length > UTXO_SIGNED_RECORD_BYTES)
    return capacity();
  assertJsonTextBudget(raw, {
    depth: 8,
    nodes: 1_000_000,
    tokenCharacters: 66000,
  });
  const value = JSON.parse(raw);
  if (
    !value ||
    Object.keys(value).length !== 5 ||
    JSON.stringify(value) !== raw ||
    value.version !== 1 ||
    value.profileId !== profileId ||
    !PROFILE.test(profileId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !validUtxoEnvelope(value.root, profileId, ROOT_DOMAIN, 'manifest') ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_RECORDS
  )
    return corrupt();
  const keys = new Set<string>();
  for (const entry of value.entries) {
    if (
      !entry ||
      Object.keys(entry).length !== 7 ||
      !HASH.test(entry.key) ||
      keys.has(entry.key) ||
      !HASH.test(entry.owner) ||
      !HASH.test(entry.chain) ||
      !HASH.test(entry.txid) ||
      entry.key !== recordKey(entry.chain, entry.txid) ||
      !['pending', 'submitted', 'confirmed'].includes(entry.phase) ||
      !validOutpoints(entry.outpoints) ||
      !Array.isArray(entry.chunks) ||
      entry.chunks.length === 0 ||
      entry.chunks.length >
        Math.ceil((2 * RAW_BYTES + 64 * 1024) / CHUNK_BYTES) ||
      !entry.chunks.every((chunk: unknown, index: number) =>
        validUtxoEnvelope(
          chunk,
          profileId,
          CHUNK_DOMAIN,
          `${entry.key}/${index}`
        )
      )
    )
      return corrupt();
    keys.add(entry.key);
  }
  return value as Bundle;
}
