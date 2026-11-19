import { isRecoveryPhraseWordCount } from '../shared/recoveryPhrase.ts';

import { matchClassicNote } from './privacy/classicNoteFormat.ts';

export type SecretQrKind = 'privateKey' | 'recoveryPhrase' | 'privateNote';

/** Admit plain import text. The owning form still validates it before import. */
export function parseSecretQr(text: string, kind: SecretQrKind): string | null {
  if (typeof text !== 'string' || text.length > 512) return null;
  const value = text.trim();
  if (kind === 'privateNote') return matchClassicNote(value) ? value : null;
  if (kind === 'recoveryPhrase') {
    const words = value.split(/\s+/u);
    return isRecoveryPhraseWordCount(words.length) &&
      words.every((word) => /^[\p{L}\p{M}]+$/u.test(word))
      ? words.join(' ')
      : null;
  }
  if (/^(?:0x)?[0-9a-f]{64}$/i.test(value))
    return value.startsWith('0X') ? `0x${value.slice(2)}` : value;

  // Bitcoin-based forms accept WIF and extended private keys. Network and
  // checksum validation belong to the normal import path.
  return /^[1-9A-HJ-NP-Za-km-z]{51,52}$/.test(value) ||
    /^(?:[xyztuv]prv)[1-9A-HJ-NP-Za-km-z]{107,108}$/.test(value)
    ? value
    : null;
}
