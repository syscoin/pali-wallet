import { identifyClassicNote } from '../utils/privacy/note';
import { assertJsonWorkBudget } from '../utils/requestPayloadBudget';

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
const MAX_JSON_NODES = 12_000;
const MAX_JSON_TOKEN_CHARS = 2048;
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const NONCE = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_NONCE = (BigInt(1) << BigInt(64)) - BigInt(1);

type Outcome = 'unknown' | 'submitted';
/** Historical hints only: never restore these as an active reservation or job. */
export interface INoteBackupDepositHistory {
  from: string;
  nonce: string;
  outcome: Outcome;
  transactionHash?: string;
}
/** Historical hints only; this codec never fetches, resumes or submits a job. */
export interface INoteBackupWithdrawalHistory {
  from?: string;
  jobId?: string;
  mode: 'direct' | 'relayed';
  nonce?: string;
  outcome: Outcome;
  transactionHash?: string;
}
export interface INoteBackupEntry {
  createdAt: number;
  history?: Readonly<{
    deposit?: Readonly<INoteBackupDepositHistory>;
    withdrawal?: Readonly<INoteBackupWithdrawalHistory>;
  }>;
  note: string;
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
const object = (
  value: unknown,
  allowed: readonly string[]
): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('BACKUP_INVALID_PAYLOAD');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return fail('BACKUP_INVALID_PAYLOAD');
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) return fail('BACKUP_INVALID_PAYLOAD');
  const snapshot: Record<string, any> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key))
      return fail('BACKUP_INVALID_PAYLOAD');
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !property.enumerable || !('value' in property))
      return fail('BACKUP_INVALID_PAYLOAD');
    snapshot[key] = property.value;
  }
  return snapshot;
};
/** Snapshot dense own data slots; never invoke a caller's iterator or map. */
const noteArray = (value: unknown): unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail('BACKUP_INVALID_PAYLOAD');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > NOTE_BACKUP_MAX_NOTES
  )
    return fail('BACKUP_INVALID_PAYLOAD');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) return fail('BACKUP_INVALID_PAYLOAD');
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !property.enumerable || !('value' in property))
      return fail('BACKUP_INVALID_PAYLOAD');
    snapshot.push(property.value);
  }
  return snapshot;
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
const hash = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !HASH.test(value))
    return fail('BACKUP_INVALID_PAYLOAD');
  return value;
};
const senderNonce = (raw: Record<string, any>, required: boolean) => {
  if (!required && raw.from === undefined && raw.nonce === undefined) return {};
  if (
    typeof raw.from !== 'string' ||
    !ADDRESS.test(raw.from) ||
    typeof raw.nonce !== 'string' ||
    !NONCE.test(raw.nonce) ||
    BigInt(raw.nonce) > MAX_NONCE
  )
    return fail('BACKUP_INVALID_PAYLOAD');
  return { from: raw.from, nonce: raw.nonce };
};
const outcome = (value: unknown): Outcome => {
  if (value !== 'unknown' && value !== 'submitted')
    return fail('BACKUP_INVALID_PAYLOAD');
  return value;
};
function history(value: unknown): INoteBackupEntry['history'] {
  if (value === undefined) return undefined;
  const raw = object(value, ['deposit', 'withdrawal']);
  if (raw.deposit === undefined && raw.withdrawal === undefined)
    return fail('BACKUP_INVALID_PAYLOAD');
  let deposit: Readonly<INoteBackupDepositHistory> | undefined;
  let withdrawal: Readonly<INoteBackupWithdrawalHistory> | undefined;
  if (raw.deposit !== undefined) {
    const entry = object(raw.deposit, [
      'outcome',
      'transactionHash',
      'from',
      'nonce',
    ]);
    const state = outcome(entry.outcome);
    const transactionHash = hash(entry.transactionHash);
    if (state === 'submitted' && !transactionHash)
      return fail('BACKUP_INVALID_PAYLOAD');
    const identity = senderNonce(entry, true) as {
      from: string;
      nonce: string;
    };
    deposit = Object.freeze({
      outcome: state,
      ...identity,
      ...(transactionHash ? { transactionHash } : {}),
    });
  }
  if (raw.withdrawal !== undefined) {
    const entry = object(raw.withdrawal, [
      'outcome',
      'mode',
      'transactionHash',
      'from',
      'nonce',
      'jobId',
    ]);
    const state = outcome(entry.outcome);
    if (entry.mode !== 'direct' && entry.mode !== 'relayed')
      return fail('BACKUP_INVALID_PAYLOAD');
    const transactionHash = hash(entry.transactionHash);
    const identity = senderNonce(entry, entry.mode === 'direct');
    if (entry.mode === 'relayed' && entry.from !== undefined)
      return fail('BACKUP_INVALID_PAYLOAD');
    if (
      entry.jobId !== undefined &&
      (entry.mode !== 'relayed' ||
        typeof entry.jobId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(entry.jobId))
    )
      return fail('BACKUP_INVALID_PAYLOAD');
    if (state === 'submitted' && !transactionHash && !entry.jobId)
      return fail('BACKUP_INVALID_PAYLOAD');
    withdrawal = Object.freeze({
      outcome: state,
      mode: entry.mode,
      ...identity,
      ...(transactionHash ? { transactionHash } : {}),
      ...(entry.jobId === undefined ? {} : { jobId: entry.jobId }),
    });
  }
  return Object.freeze({
    ...(deposit ? { deposit } : {}),
    ...(withdrawal ? { withdrawal } : {}),
  });
}

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
    const notes = noteArray(raw.notes).map((item: unknown) => {
      const entry = object(item, ['note', 'createdAt', 'history']);
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
      const hints = history(entry.history);
      return Object.freeze({
        note: entry.note,
        createdAt: noteCreatedAt,
        ...(hints ? { history: hints } : {}),
      });
    });
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
