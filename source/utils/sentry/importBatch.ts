import {
  sentryPrivateLabelParts,
  sentryShakePrivateLabelParts,
} from '../../shared/sentryKeyLabel.ts';

import type { SentryAuthorityScheme } from '../../wallet/sentryKeyVault.ts';

export interface SentryImportLine {
  label: string;
  line: number;
  secretKey: string;
}
export interface SentryImportIssue {
  line: number;
  reason: 'format' | 'label' | 'key' | 'duplicate' | 'limit';
}

// Labels are rendered outside the masked input. Reject complete key-shaped
// values even when misplaced from another row, before creating a preview.
export const containsSentryPrivateKey = (label: string) =>
  /[0-9a-fA-F]{64}|[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}/.test(label);

/** The hosts supply only their registered network's WIF decoder. */
export function normalizeSentryKeyImportEntries(
  entries: readonly Pick<SentryImportLine, 'label' | 'secretKey'>[],
  scheme: SentryAuthorityScheme,
  decodeWif: (value: string) => string
): Pick<SentryImportLine, 'label' | 'secretKey'>[] {
  if (!Array.isArray(entries) || !entries.length || entries.length > 20)
    throw new Error('Import between 1 and 20 Sentry keys at a time');
  const privateInputs = entries.flatMap((entry) => {
    const secretKey = entry?.secretKey;
    return typeof secretKey === 'string'
      ? sentryPrivateLabelParts(secretKey)
      : [];
  });
  if (
    entries.some(
      (entry) =>
        typeof entry?.label === 'string' &&
        privateInputs.some((value) => entry.label.toLowerCase().includes(value))
    )
  )
    throw new Error('Key labels must not contain private keys');
  if (!['bls-basic', 'slh-dsa-shake-128s', 'secp256k1'].includes(scheme))
    throw new Error('Unsupported Sentry operator key scheme');
  const hex = new RegExp(
    `^(?:0x)?[0-9a-fA-F]{${scheme === 'slh-dsa-shake-128s' ? 128 : 64}}$`
  );
  return entries.map((entry, index) => {
    if (
      !entry ||
      typeof entry.label !== 'string' ||
      !entry.label.trim() ||
      entry.label.trim().length > 80
    )
      throw new Error(`Key ${index + 1}: enter a label of 1 to 80 characters`);
    let secretKey = entry.secretKey;
    if (
      scheme === 'secp256k1' &&
      typeof secretKey === 'string' &&
      !hex.test(secretKey)
    ) {
      try {
        secretKey = decodeWif(secretKey);
      } catch {
        throw new Error(
          `Key ${
            index + 1
          }: enter a voting/owner WIF for the selected network, or a 32-byte hexadecimal private key`
        );
      }
    }
    if (typeof secretKey !== 'string' || !hex.test(secretKey))
      throw new Error(
        `Key ${
          index + 1
        }: enter a complete hexadecimal Sentry operator private key`
      );
    return {
      label: entry.label.trim(),
      secretKey: secretKey.replace(/^0x/, '').toLowerCase(),
    };
  });
}

/** Parse only local form text. Errors never contain key material. */
export const parseSentryKeyBatch = (
  text: string,
  scheme: SentryAuthorityScheme,
  defaultLabel = 'Sentry key'
): { entries: SentryImportLine[]; issues: SentryImportIssue[] } => {
  const entries: SentryImportLine[] = [];
  const issues: SentryImportIssue[] = [];
  const seen = new Set<string>();
  if (text.length > 6000)
    return { entries, issues: [{ line: 0, reason: 'limit' }] };
  const rows = text.split(/\r?\n/);
  // The extension can preview valid rows even when other rows fail.
  const privateParts =
    scheme === 'slh-dsa-shake-128s'
      ? rows.flatMap((row) =>
          row
            .split('|')
            .flatMap((cell) => sentryShakePrivateLabelParts(cell.trim()))
        )
      : [];
  for (const [index, row] of rows.entries()) {
    const value = row.trim();
    if (!value) continue;
    const line = index + 1;
    if (entries.length + issues.length >= 20) {
      issues.push({ line, reason: 'limit' });
      break;
    }
    const parts = value.split('|');
    if (parts.length > 2) {
      issues.push({ line, reason: 'format' });
      continue;
    }
    const [first = '', second] = parts;
    const secretKey = (second ?? first).trim();
    const label =
      second !== undefined && first.trim()
        ? first.trim()
        : `${defaultLabel} ${entries.length + 1}`;
    const lowerLabel = label.toLowerCase();
    if (
      label.length > 80 ||
      containsSentryPrivateKey(label) ||
      privateParts.some((part) => lowerLabel.includes(part))
    ) {
      issues.push({ line, reason: 'label' });
      continue;
    }
    const digits = scheme === 'slh-dsa-shake-128s' ? 128 : 64;
    const isHex = new RegExp(`^(?:0x)?[0-9a-fA-F]{${digits}}$`).test(secretKey);
    const isWif =
      scheme === 'secp256k1' && /^[1-9A-HJ-NP-Za-km-z]{50,53}$/.test(secretKey);
    if (!isHex && !isWif) {
      issues.push({ line, reason: 'key' });
      continue;
    }
    const identity = isHex
      ? secretKey.replace(/^0x/, '').toLowerCase()
      : secretKey;
    if (seen.has(identity)) {
      issues.push({ line, reason: 'duplicate' });
      continue;
    }
    seen.add(identity);
    entries.push({ line, label, secretKey });
  }
  return { entries, issues };
};
