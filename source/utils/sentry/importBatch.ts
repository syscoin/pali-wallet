import type { SentryAuthorityScheme } from '@sidhujag/sysweb3-sentry';

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
const containsPrivateKey = (label: string) =>
  /[0-9a-fA-F]{64}|[5KL9c][1-9A-HJ-NP-Za-km-z]{50,51}/.test(label);

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
    const secretKey = parts[parts.length - 1].trim();
    const label =
      parts.length === 2 && parts[0].trim()
        ? parts[0].trim()
        : `${defaultLabel} ${entries.length + 1}`;
    if (label.length > 80 || containsPrivateKey(label)) {
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
