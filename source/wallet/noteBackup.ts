import { identifyClassicNote } from '../utils/privacy/note';
import { assertJsonWorkBudget } from '../utils/requestPayloadBudget';
import {
  snapshotBackupObject as object,
  snapshotBackupArray,
  validateNoteBackupHistory,
} from './noteBackupHistory';
import type { INoteBackupHistory } from './noteBackupHistory';
export {
  NOTE_BACKUP_MAX_HISTORY_HINTS,
  validateNoteBackupHistory,
  mergeNoteBackupHistories,
} from './noteBackupHistory';
export type {
  INoteBackupDepositHistory,
  INoteBackupWithdrawalHistory,
  INoteBackupHistory,
} from './noteBackupHistory';

export const NOTE_BACKUP_FORMAT = 'pali-private-notes';
export const NOTE_BACKUP_HEADER_BYTES = 64;
export const NOTE_BACKUP_MAX_NOTES = 512;
export const NOTE_BACKUP_MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const NOTE_BACKUP_MAX_FILE_BYTES =
  NOTE_BACKUP_HEADER_BYTES + NOTE_BACKUP_MAX_PLAINTEXT_BYTES + 16;
export const NOTE_BACKUP_KDF_ITERATIONS = 900_000;

const MAGIC = [80, 65, 76, 73, 78, 79, 84, 69]; // PALINOTE
const DATE_MAX = 8_640_000_000_000_000;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 65_536;
const MAX_JSON_TOKEN_CHARS = 2048;
export interface INoteBackupEntry {
  createdAt: number;
  history?: Readonly<INoteBackupHistory>;
  note: string;
  reconciliationRequired?: true;
}
/** Secret-bearing data. Keep inside the trusted wallet authority, never UI state. */
export interface INoteBackupPayload {
  createdAt: number;
  format: typeof NOTE_BACKUP_FORMAT;
  notes: readonly Readonly<INoteBackupEntry>[];
  version: 1;
}
export type NoteBackupErrorCode =
  | 'BACKUP_INVALID_FORMAT'
  | 'BACKUP_INVALID_PAYLOAD'
  | 'BACKUP_INVALID_PASSWORD'
  | 'BACKUP_OPEN_FAILED'
  | 'BACKUP_CANCELLED'
  | 'BACKUP_UNAVAILABLE';
export class NoteBackupError extends Error {
  readonly code: NoteBackupErrorCode;
  constructor(code: NoteBackupErrorCode) {
    super(code);
    this.name = 'NoteBackupError';
    this.code = code;
  }
}
const fail = (code: NoteBackupErrorCode): never => {
  throw new NoteBackupError(code);
};
const wellFormed = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = text.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
const timestamp = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > DATE_MAX
  )
    return fail('BACKUP_INVALID_PAYLOAD');
  return value;
};
/** Recompute identities; return a detached frozen allowlist, never caller objects. */
export function validateNoteBackupPayload(
  value: unknown
): Readonly<INoteBackupPayload> {
  try {
    const raw = object(value, ['format', 'version', 'createdAt', 'notes']);
    if (raw.format !== NOTE_BACKUP_FORMAT || raw.version !== 1)
      return fail('BACKUP_INVALID_PAYLOAD');
    const createdAt = timestamp(raw.createdAt);
    const identities = new Set<string>();
    const notes = snapshotBackupArray(raw.notes, NOTE_BACKUP_MAX_NOTES).map(
      (item: unknown) => {
        const entry = object(item, [
          'note',
          'createdAt',
          'reconciliationRequired',
          'history',
        ]);
        if (
          typeof entry.note !== 'string' ||
          entry.note.length > MAX_JSON_TOKEN_CHARS ||
          !wellFormed(entry.note) ||
          entry.note !== entry.note.trim().toLowerCase()
        )
          return fail('BACKUP_INVALID_PAYLOAD');
        const identity = identifyClassicNote(entry.note);
        const key = `${identity.poolId}:${identity.commitment}`;
        if (identities.has(key)) return fail('BACKUP_INVALID_PAYLOAD');
        identities.add(key);
        const noteCreatedAt = timestamp(entry.createdAt);
        if (
          entry.reconciliationRequired !== undefined &&
          entry.reconciliationRequired !== true
        )
          return fail('BACKUP_INVALID_PAYLOAD');
        const hints =
          entry.history === undefined
            ? undefined
            : validateNoteBackupHistory(entry.history);
        return Object.freeze({
          note: entry.note,
          createdAt: noteCreatedAt,
          ...(entry.reconciliationRequired === true
            ? { reconciliationRequired: true as const }
            : {}),
          ...(hints ? { history: hints } : {}),
        });
      }
    );
    // Fixed property order is the canonical wire encoding. No normalization of
    // passwords or alternate encodings is implicit in this payload validator.
    const payload = Object.freeze({
      format: NOTE_BACKUP_FORMAT,
      version: 1 as const,
      createdAt,
      notes: Object.freeze(notes),
    });
    // The fixed-depth schema and dense slot limit bound validation above. Only
    // traverse the detached allowlist here, never caller-controlled accessors.
    assertJsonWorkBudget(
      payload,
      NOTE_BACKUP_MAX_PLAINTEXT_BYTES,
      MAX_JSON_DEPTH,
      MAX_JSON_NODES
    );
    return payload;
  } catch {
    return fail('BACKUP_INVALID_PAYLOAD');
  }
}

/** Bound allocations before JSON.parse. Canonical JSON has no external whitespace. */
function checkJsonWork(text: string): void {
  let depth = 0;
  let nodes = 0;
  const node = () => {
    if (++nodes > MAX_JSON_NODES) fail('BACKUP_INVALID_PAYLOAD');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{' || char === '[') {
      node();
      if (++depth > MAX_JSON_DEPTH) fail('BACKUP_INVALID_PAYLOAD');
    } else if (char === '}' || char === ']') {
      if (--depth < 0) fail('BACKUP_INVALID_PAYLOAD');
    } else if (char === '"') {
      const start = ++i;
      for (; i < text.length; i++) {
        if (i - start > MAX_JSON_TOKEN_CHARS) fail('BACKUP_INVALID_PAYLOAD');
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      if (i >= text.length) fail('BACKUP_INVALID_PAYLOAD');
      if (text[i + 1] !== ':') node();
    } else if (char === ',' || char === ':') {
      // Syntax is checked by JSON.parse after this work budget.
    } else {
      if (char <= ' ') fail('BACKUP_INVALID_PAYLOAD');
      node();
      while (i + 1 < text.length && !',]}:'.includes(text[i + 1])) {
        if (text[++i] <= ' ') fail('BACKUP_INVALID_PAYLOAD');
      }
    }
  }
  if (depth !== 0) fail('BACKUP_INVALID_PAYLOAD');
}
// Read internal typed-array slots, not overridable subclass/own properties.
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'buffer'
)!.get!;
const typedArrayOffset = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset'
)!.get!;
const typedArrayLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength'
)!.get!;
const ownBytes = (
  value: unknown,
  max: number,
  code: NoteBackupErrorCode
): Uint8Array<ArrayBuffer> => {
  try {
    if (!(value instanceof Uint8Array)) return fail(code);
    const buffer = typedArrayBuffer.call(value);
    const byteOffset = typedArrayOffset.call(value);
    const byteLength = typedArrayLength.call(value);
    if (!(buffer instanceof ArrayBuffer) || byteLength > max) return fail(code);
    return new Uint8Array(new Uint8Array(buffer, byteOffset, byteLength));
  } catch {
    return fail(code);
  }
};
function header(file: Uint8Array): number {
  if (
    file.length < NOTE_BACKUP_HEADER_BYTES + 16 ||
    MAGIC.some((value, index) => file[index] !== value) ||
    file[8] !== 1 ||
    file[9] !== 1 ||
    file[10] !== 1 ||
    file[11] !== 0 ||
    file.subarray(60, 64).some((value) => value !== 0)
  )
    return fail('BACKUP_INVALID_FORMAT');
  const length = new DataView(
    file.buffer,
    file.byteOffset,
    file.byteLength
  ).getUint32(56, false);
  if (
    length < 16 ||
    length > NOTE_BACKUP_MAX_PLAINTEXT_BYTES + 16 ||
    file.length !== NOTE_BACKUP_HEADER_BYTES + length
  )
    return fail('BACKUP_INVALID_FORMAT');
  return length;
}
export function inspectNoteBackupHeader(value: unknown): Readonly<{
  ciphertextBytes: number;
  suite: 'PBKDF2-SHA512-A256GCM';
  version: 1;
}> {
  const file = ownBytes(
    value,
    NOTE_BACKUP_MAX_FILE_BYTES,
    'BACKUP_INVALID_FORMAT'
  );
  return Object.freeze({
    version: 1,
    suite: 'PBKDF2-SHA512-A256GCM',
    ciphertextBytes: header(file),
  });
}

export interface INoteBackupCodecPorts {
  assertCurrent: () => void;
  crypto: Pick<Crypto, 'getRandomValues' | 'subtle'>;
}
/** No browser storage, globals, SDK sessions, network calls or automatic replay. */
export function createNoteBackupCodec(ports: INoteBackupCodecPorts) {
  if (
    !ports ||
    typeof ports.assertCurrent !== 'function' ||
    typeof TextEncoder !== 'function' ||
    typeof TextDecoder !== 'function' ||
    typeof ports.crypto?.getRandomValues !== 'function' ||
    typeof ports.crypto?.subtle?.importKey !== 'function' ||
    typeof ports.crypto?.subtle?.deriveKey !== 'function' ||
    typeof ports.crypto?.subtle?.encrypt !== 'function' ||
    typeof ports.crypto?.subtle?.decrypt !== 'function'
  )
    return fail('BACKUP_UNAVAILABLE');
  const cryptography = ports.crypto;
  const assertCurrent = ports.assertCurrent;
  const current = () => {
    let result: unknown;
    try {
      result = assertCurrent();
    } catch {
      return fail('BACKUP_CANCELLED');
    }
    // TypeScript permits async callbacks where void is expected. Admission must
    // complete synchronously; never run cryptography ahead of a pending guard.
    try {
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        void Promise.resolve(result).catch(() => undefined);
        return fail('BACKUP_UNAVAILABLE');
      }
    } catch {
      return fail('BACKUP_UNAVAILABLE');
    }
  };
  const random = (bytes: Uint8Array<ArrayBuffer>) => {
    const result = cryptography.getRandomValues(bytes) as unknown;
    if (result !== bytes) {
      if (
        result &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      )
        void Promise.resolve(result).catch(() => undefined);
      fail('BACKUP_UNAVAILABLE');
    }
  };
  const passwordBytes = (
    password: unknown,
    encrypting: boolean
  ): Uint8Array => {
    if (
      typeof password !== 'string' ||
      !wellFormed(password) ||
      !password.length ||
      password.length > 1024 ||
      (encrypting && Array.from(password).length < 12)
    )
      return fail('BACKUP_INVALID_PASSWORD');
    const bytes = new TextEncoder().encode(password);
    if (bytes.length > 1024) {
      bytes.fill(0);
      return fail('BACKUP_INVALID_PASSWORD');
    }
    return bytes;
  };
  const deriveKey = async (
    password: Uint8Array,
    salt: Uint8Array,
    usage: 'encrypt' | 'decrypt'
  ) => {
    const imported = await cryptography.subtle.importKey(
      'raw',
      password as BufferSource,
      'PBKDF2',
      false,
      ['deriveKey']
    );
    current();
    const key = await cryptography.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-512',
        salt: salt as BufferSource,
        iterations: NOTE_BACKUP_KDF_ITERATIONS,
      },
      imported,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage]
    );
    current();
    return key;
  };
  const safeFailure = (error: unknown): never => {
    current();
    if (error instanceof NoteBackupError) throw error;
    return fail('BACKUP_UNAVAILABLE');
  };
  return Object.freeze({
    async encrypt(value: unknown, password: unknown): Promise<Uint8Array> {
      current();
      const secret = passwordBytes(password, true);
      let plaintext: Uint8Array | undefined;
      try {
        const payload = validateNoteBackupPayload(value);
        plaintext = new TextEncoder().encode(JSON.stringify(payload));
        if (plaintext.length > NOTE_BACKUP_MAX_PLAINTEXT_BYTES)
          fail('BACKUP_INVALID_PAYLOAD');
        const prefix = new Uint8Array(NOTE_BACKUP_HEADER_BYTES);
        prefix.set(MAGIC);
        prefix.set([1, 1, 1, 0], 8);
        random(prefix.subarray(12, 44));
        random(prefix.subarray(44, 56));
        new DataView(prefix.buffer).setUint32(56, plaintext.length + 16, false);
        current();
        const key = await deriveKey(secret, prefix.subarray(12, 44), 'encrypt');
        const ciphertext = await cryptography.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: prefix.subarray(44, 56),
            additionalData: prefix,
            tagLength: 128,
          },
          key,
          plaintext as BufferSource
        );
        current();
        if (ciphertext.byteLength !== plaintext.length + 16)
          fail('BACKUP_UNAVAILABLE');
        const result = new Uint8Array(prefix.length + ciphertext.byteLength);
        result.set(prefix);
        result.set(new Uint8Array(ciphertext), prefix.length);
        return result;
      } catch (error) {
        return safeFailure(error);
      } finally {
        secret.fill(0);
        plaintext?.fill(0);
      }
    },
    /** Returns bearer secrets to the trusted authority only, never a UI DTO. */
    async decrypt(
      value: unknown,
      password: unknown
    ): Promise<Readonly<INoteBackupPayload>> {
      current();
      const file = ownBytes(
        value,
        NOTE_BACKUP_MAX_FILE_BYTES,
        'BACKUP_INVALID_FORMAT'
      );
      header(file); // Reject framing/suite/cost before password KDF or decryption.
      const secret = passwordBytes(password, false);
      let plaintext: Uint8Array | undefined;
      try {
        const key = await deriveKey(secret, file.subarray(12, 44), 'decrypt');
        try {
          plaintext = new Uint8Array(
            await cryptography.subtle.decrypt(
              {
                name: 'AES-GCM',
                iv: file.subarray(44, 56),
                additionalData: file.subarray(0, 64),
                tagLength: 128,
              },
              key,
              file.subarray(64)
            )
          );
        } catch (error) {
          current();
          if (
            error &&
            typeof error === 'object' &&
            'name' in error &&
            error.name === 'OperationError'
          )
            return fail('BACKUP_OPEN_FAILED');
          return fail('BACKUP_UNAVAILABLE');
        }
        current();
        if (plaintext.length > NOTE_BACKUP_MAX_PLAINTEXT_BYTES)
          fail('BACKUP_INVALID_PAYLOAD');
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
        } catch {
          return fail('BACKUP_INVALID_PAYLOAD');
        }
        checkJsonWork(text);
        let payload: Readonly<INoteBackupPayload>;
        try {
          payload = validateNoteBackupPayload(JSON.parse(text));
        } catch {
          return fail('BACKUP_INVALID_PAYLOAD');
        }
        if (JSON.stringify(payload) !== text) fail('BACKUP_INVALID_PAYLOAD');
        current();
        return payload;
      } catch (error) {
        return safeFailure(error);
      } finally {
        secret.fill(0);
        plaintext?.fill(0);
      }
    },
  });
}
