// Chrome extension messages use JSON serialization. Transport encrypted bytes
// as canonical base64, bounded before decoding; never send a decoded inventory.
export const NOTE_BACKUP_FILE_LIMIT = 8 * 1024 * 1024 + 80;
export const NOTE_BACKUP_WIRE_LIMIT = 4 * Math.ceil(NOTE_BACKUP_FILE_LIMIT / 3);

const invalid = (): never => {
  throw new Error('BACKUP_INVALID_FORMAT');
};

export function encodeNoteBackupFile(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length > NOTE_BACKUP_FILE_LIMIT)
    return invalid();
  const chunks: string[] = [];
  // A multiple of three avoids padding between encoded chunks.
  for (let offset = 0; offset < bytes.length; offset += 12_288) {
    const chunk = bytes.subarray(offset, offset + 12_288);
    chunks.push(btoa(String.fromCharCode(...chunk)));
  }
  return chunks.join('');
}

export function decodeNoteBackupFile(value: unknown): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > NOTE_BACKUP_WIRE_LIMIT ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return invalid();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const size = (value.length / 4) * 3 - padding;
  if (size > NOTE_BACKUP_FILE_LIMIT) return invalid();
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Reject nonzero unused bits: there is exactly one accepted spelling per file.
  if (
    (padding === 2 && (alphabet.indexOf(value[value.length - 3]) & 15) !== 0) ||
    (padding === 1 && (alphabet.indexOf(value[value.length - 2]) & 3) !== 0)
  )
    return invalid();
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return invalid();
  }
}
