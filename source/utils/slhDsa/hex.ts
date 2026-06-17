import { SLH_DSA_PUBLIC_KEY_FIELD_LENGTH } from './constants';

export const stripHexPrefix = (value: string) =>
  value.startsWith('0x') ? value.slice(2) : value;

export const bytesToHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;

export const hexToBytes = (value: string): Uint8Array => {
  const normalized = stripHexPrefix(value);
  if (normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
    throw new Error('Invalid hex string');
  }

  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

export const concatBytes = (...parts: Uint8Array[]) => {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
};

export const normalizeSLHDSAPublicKeyField = (value: string) => {
  const bytes = hexToBytes(value);
  if (bytes.length === 32) {
    return bytesToHex(bytes);
  }
  if (bytes.length !== SLH_DSA_PUBLIC_KEY_FIELD_LENGTH) {
    throw new Error('SLH-DSA public key field must be 16 or 32 bytes');
  }

  const out = new Uint8Array(32);
  out.set(bytes, 0);
  return bytesToHex(out);
};
