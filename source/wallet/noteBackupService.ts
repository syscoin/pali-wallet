import {
  createNoteBackupCodec,
  NOTE_BACKUP_MAX_FILE_BYTES,
  NoteBackupError,
  validateNoteBackupPayload,
} from './noteBackup';
import type { INoteBackupEntry } from './noteBackup';
import { readPrivateNoteRestoreMetadata } from './privateNoteRestore';
import type { IPrivateNoteRestoreReceipt } from './privateNoteRestore';
import type {
  IPrivateVaultRestoreController,
  IPrivateVaultRestorePlan,
  IPrivateVaultSession,
} from './privateVault';

export const NOTE_BACKUP_PREVIEW_TTL_MS = 300_000;
export type NoteBackupServiceErrorCode =
  | 'BACKUP_AUTHENTICATION_FAILED'
  | 'BACKUP_BUSY'
  | 'BACKUP_CANCELLED'
  | 'BACKUP_COMMIT_UNCONFIRMED'
  | 'BACKUP_INVALID_FORMAT'
  | 'BACKUP_INVALID_PASSWORD'
  | 'BACKUP_INVALID_PAYLOAD'
  | 'BACKUP_NOTE_LIMIT'
  | 'BACKUP_OPEN_FAILED'
  | 'BACKUP_STALE'
  | 'BACKUP_UNAVAILABLE';

export class NoteBackupServiceError extends Error {
  readonly code: NoteBackupServiceErrorCode;
  constructor(code: NoteBackupServiceErrorCode) {
    super(code);
    this.name = 'NoteBackupServiceError';
    this.code = code;
  }
}

/** Public, data-only summary. Neither this ID nor a file password authorizes a write. */
export interface INoteBackupPreview {
  readonly added: number;
  readonly duplicates: number;
  readonly expiresAt: number;
  readonly guarded: number;
  readonly id: string;
}
export interface INoteBackupConfirmation {
  readonly added: number;
  readonly confirmed: true;
  readonly duplicates: number;
  readonly guarded: number;
  readonly id: string;
}
export interface INoteBackupExport {
  readonly bytes: Uint8Array;
  readonly createdAt: number;
  readonly id: string;
  readonly noteCount: number;
}
export interface INoteBackupVerification {
  readonly createdAt: number;
  readonly id: string;
  readonly noteCount: number;
  readonly verified: true;
}
export interface INoteBackupServicePorts {
  captureSession: () => IPrivateVaultSession;
  crypto: Pick<Crypto, 'getRandomValues' | 'subtle'>;
  /** Monotonic elapsed milliseconds for this operation's private lifetime. */
  monotonicNow: () => number;
  randomId: () => string;
  /** Must return synchronous cancellation; hosts must clear retained callbacks. */
  scheduleExpiry: (expire: () => void, delayMs: number) => () => void;
  /** Lock, wallet replacement and host shutdown must synchronously notify here. */
  subscribeInvalidation: (invalidate: () => void) => () => void;
  vault: IPrivateVaultRestoreController;
}
export interface INoteBackupService {
  /** Reserve the sole slot synchronously so even a pending KDF can be cancelled. */
  begin: () => string;
  cancel: (id: string) => void;
  commitImport: (
    id: string,
    walletPassword: string
  ) => Promise<Readonly<INoteBackupConfirmation>>;
  dispose: () => void;
  exportEncrypted: (
    id: string,
    walletPassword: string,
    backupPassword: string
  ) => Promise<Readonly<INoteBackupExport>>;
  prepareImport: (
    id: string,
    ciphertext: unknown,
    backupPassword: string
  ) => Promise<Readonly<INoteBackupPreview>>;
  /** null is unconfirmed, never permission to replay an attempted commit. */
  readCommitReceipt: (
    id: string
  ) => Promise<Readonly<INoteBackupConfirmation> | null>;
  verifyExport: (
    id: string,
    readBackBytes: unknown,
    backupPassword: string
  ) => Promise<Readonly<INoteBackupVerification>>;
}

interface IOperation {
  alive: boolean;
  base?: IPrivateVaultSession;
  cancelTimer?: () => void;
  ciphertext?: Uint8Array;
  createdAt?: number;
  entries?: readonly Readonly<INoteBackupEntry>[];
  expiresAt: number;
  id?: string;
  noteCount?: number;
  phase:
    | 'reserved'
    | 'exporting'
    | 'export'
    | 'verifying'
    | 'preparing'
    | 'preview'
    | 'committing'
    | 'reading';
  plan?: IPrivateVaultRestorePlan;
  session?: IPrivateVaultSession;
}
interface IReceiptCorrelation {
  base: IPrivateVaultSession;
  cancelTimer?: () => void;
  expected: IPrivateVaultRestorePlan;
  expiresAt: number;
  id: string;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail = (code: NoteBackupServiceErrorCode): never => {
  throw new NoteBackupServiceError(code);
};
const ERROR_CODES = new Set<NoteBackupServiceErrorCode>([
  'BACKUP_AUTHENTICATION_FAILED',
  'BACKUP_BUSY',
  'BACKUP_CANCELLED',
  'BACKUP_COMMIT_UNCONFIRMED',
  'BACKUP_INVALID_FORMAT',
  'BACKUP_INVALID_PASSWORD',
  'BACKUP_INVALID_PAYLOAD',
  'BACKUP_NOTE_LIMIT',
  'BACKUP_OPEN_FAILED',
  'BACKUP_STALE',
  'BACKUP_UNAVAILABLE',
]);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteBuffer = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'buffer'
)!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset'
)!.get!;
const byteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength'
)!.get!;
const copyFile = (value: unknown): Uint8Array<ArrayBuffer> => {
  try {
    if (!(value instanceof Uint8Array)) return fail('BACKUP_INVALID_FORMAT');
    const buffer = byteBuffer.call(value);
    const offset = byteOffset.call(value);
    const length = byteLength.call(value);
    if (!(buffer instanceof ArrayBuffer) || length > NOTE_BACKUP_MAX_FILE_BYTES)
      return fail('BACKUP_INVALID_FORMAT');
    return new Uint8Array(new Uint8Array(buffer, offset, length));
  } catch {
    return fail('BACKUP_INVALID_FORMAT');
  }
};
/** Void ports must finish now. A pending guard is not an authorization decision. */
const synchronous = (invoke: () => unknown) => {
  const result = invoke();
  if (
    result &&
    (typeof result === 'object' || typeof result === 'function') &&
    typeof (result as PromiseLike<unknown>).then === 'function'
  ) {
    void Promise.resolve(result).catch(() => undefined);
    fail('BACKUP_UNAVAILABLE');
  }
};

/**
 * Trusted-authority orchestration only. Hosts supply lifecycle notification and
 * expiry scheduling; no globals, file transport, profile search or network I/O.
 * At most one operation/decoded inventory exists, with a five-minute lifetime.
 * Strings/CryptoKeys cannot be provably zeroized; references are dropped promptly.
 */
export function createNoteBackupService(
  ports: INoteBackupServicePorts
): Readonly<INoteBackupService> {
  if (
    !ports ||
    typeof ports.captureSession !== 'function' ||
    typeof ports.monotonicNow !== 'function' ||
    typeof ports.randomId !== 'function' ||
    typeof ports.scheduleExpiry !== 'function' ||
    typeof ports.subscribeInvalidation !== 'function' ||
    !ports.vault ||
    ![
      ports.vault.cancelRestore,
      ports.vault.prepareRestore,
      ports.vault.commitRestore,
      ports.vault.exportBackupSnapshot,
      ports.vault.getRestoreReceipt,
    ].every((method) => typeof method === 'function')
  )
    return fail('BACKUP_UNAVAILABLE');
  let active: IOperation | undefined;
  // Cancellation revokes authority immediately but cannot cancel native KDFs.
  // Keep admission closed until the old asynchronous work actually settles.
  let running: IOperation | undefined;
  let correlation: IReceiptCorrelation | undefined;
  let disposed = false;
  let admitting = false;
  let checking = 0;
  let cleaning = 0;
  let lastNow = -1;
  let lastId: string | undefined;
  const nextId = () => {
    const id = ports.randomId();
    if (typeof id !== 'string' || !UUID.test(id) || id === lastId)
      return fail('BACKUP_UNAVAILABLE');
    lastId = id;
    return id;
  };
  const now = () => {
    const value = ports.monotonicNow();
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value < lastNow ||
      value > Number.MAX_SAFE_INTEGER - NOTE_BACKUP_PREVIEW_TTL_MS
    )
      return fail('BACKUP_UNAVAILABLE');
    lastNow = value;
    return value;
  };
  const cleanup = (callback?: () => void) => {
    cleaning++;
    try {
      if (callback) synchronous(callback);
    } catch {
      // Revocation happened first; an uncooperative host cannot restore authority.
    } finally {
      cleaning--;
    }
  };
  const forgetReceipt = () => {
    const previous = correlation;
    correlation = undefined;
    cleanup(previous?.cancelTimer);
  };
  const finish = (operation: IOperation) => {
    operation.alive = false;
    operation.entries = undefined;
    operation.ciphertext?.fill(0);
    operation.ciphertext = undefined;
    const plan = operation.plan;
    operation.plan = undefined;
    if (active === operation) active = undefined;
    const cancelTimer = operation.cancelTimer;
    operation.cancelTimer = undefined;
    cleanup(cancelTimer);
    if (plan) cleanup(() => ports.vault.cancelRestore(plan));
  };
  const cancelAll = () => {
    if (active) finish(active);
    forgetReceipt();
  };
  const cancel = (id: string) => {
    if (active?.id === id) finish(active);
    // A write can already be durable when its response is cancelled. Retain
    // only public correlation for an explicit same-session receipt check.
    // Lock, expiry and disposal still discard that correlation entirely.
  };
  const assertOperation = (operation: IOperation) => {
    if (disposed || !operation.alive || active !== operation)
      return fail('BACKUP_CANCELLED');
    checking++;
    try {
      if (now() >= operation.expiresAt) return fail('BACKUP_STALE');
      if (!operation.base) return fail('BACKUP_UNAVAILABLE');
      synchronous(() => operation.base!.assertCurrent());
      if (!operation.alive || active !== operation || disposed)
        return fail('BACKUP_CANCELLED');
    } catch (error) {
      finish(operation);
      throw error;
    } finally {
      checking--;
    }
  };
  const admit = (
    phase: IOperation['phase'],
    expiresAt?: number
  ): IOperation => {
    if (disposed) return fail('BACKUP_UNAVAILABLE');
    if (running || cleaning) return fail('BACKUP_BUSY');
    if (active) {
      const previous = active;
      try {
        assertOperation(previous);
      } catch {
        finish(previous);
      }
      if (active) return fail('BACKUP_BUSY');
    }
    const start = now();
    const operation: IOperation = {
      alive: true,
      phase,
      expiresAt: Math.min(
        start + NOTE_BACKUP_PREVIEW_TTL_MS,
        expiresAt ?? Infinity
      ),
    };
    // Install admission before calling any host port, including capture/timers.
    active = operation;
    try {
      const base = ports.captureSession();
      if (
        !base ||
        typeof base.assertCurrent !== 'function' ||
        !base.keyring ||
        !Number.isSafeInteger(base.generation) ||
        base.generation < 0
      )
        return fail('BACKUP_UNAVAILABLE');
      operation.base = base;
      operation.session = {
        keyring: base.keyring,
        generation: base.generation,
        assertCurrent: () => assertOperation(operation),
      };
      assertOperation(operation);
      const cancelTimer = ports.scheduleExpiry(() => {
        if (active === operation) finish(operation);
      }, operation.expiresAt - start);
      if (typeof cancelTimer !== 'function') return fail('BACKUP_UNAVAILABLE');
      operation.cancelTimer = cancelTimer;
      assertOperation(operation);
      return operation;
    } catch (error) {
      finish(operation);
      throw safeError(error);
    }
  };
  const safeError = (error: unknown): NoteBackupServiceError => {
    let message = '';
    try {
      if (
        (error instanceof NoteBackupServiceError ||
          error instanceof NoteBackupError) &&
        ERROR_CODES.has(error.code)
      )
        return new NoteBackupServiceError(error.code);
      if (error instanceof Error && typeof error.message === 'string')
        message = error.message;
    } catch {
      return new NoteBackupServiceError('BACKUP_UNAVAILABLE');
    }
    if (
      message === 'Invalid password' ||
      message.startsWith('Too many failed attempts.')
    )
      return new NoteBackupServiceError('BACKUP_AUTHENTICATION_FAILED');
    if (message === 'privacy_note_limit')
      return new NoteBackupServiceError('BACKUP_NOTE_LIMIT');
    if (message === 'privacy_restore_stale')
      return new NoteBackupServiceError('BACKUP_STALE');
    if (message === 'privacy_restore_invalid')
      return new NoteBackupServiceError('BACKUP_INVALID_PAYLOAD');
    if (
      message === 'privacy_vault_locked' ||
      message === 'privacy_vault_session_changed'
    )
      return new NoteBackupServiceError('BACKUP_CANCELLED');
    return new NoteBackupServiceError('BACKUP_UNAVAILABLE');
  };
  const beginOperation = (
    phase: IOperation['phase'],
    expiresAt?: number
  ): IOperation => {
    if (admitting || checking) return fail('BACKUP_BUSY');
    admitting = true;
    try {
      return admit(phase, expiresAt);
    } catch (error) {
      throw safeError(error);
    } finally {
      admitting = false;
    }
  };
  const reserved = (id: string, phase: IOperation['phase']) => {
    const operation = active;
    if (!operation || operation.phase !== 'reserved' || operation.id !== id)
      return fail('BACKUP_STALE');
    try {
      assertOperation(operation);
      operation.phase = phase;
      running = operation;
      return operation;
    } catch (error) {
      finish(operation);
      throw safeError(error);
    }
  };
  const failure = (operation: IOperation, error: unknown) => {
    try {
      assertOperation(operation);
    } catch (revoked) {
      return safeError(revoked);
    }
    return safeError(error);
  };
  const confirmation = (
    record: IReceiptCorrelation,
    receipt: IPrivateNoteRestoreReceipt
  ): Readonly<INoteBackupConfirmation> | null => {
    const validated = readPrivateNoteRestoreMetadata({ version: 1, receipt })
      .receipt!;
    if (
      validated.id !== record.expected.id ||
      validated.added !== record.expected.added ||
      validated.duplicates !== record.expected.duplicates ||
      validated.guarded !== record.expected.guarded
    )
      return null;
    return Object.freeze({
      id: record.id,
      added: validated.added,
      duplicates: validated.duplicates,
      guarded: validated.guarded,
      confirmed: true as const,
    });
  };
  const rememberReceipt = (operation: IOperation) => {
    forgetReceipt();
    const record: IReceiptCorrelation = {
      base: operation.base!,
      expected: operation.plan!,
      expiresAt: operation.expiresAt,
      id: operation.id!,
    };
    correlation = record;
    try {
      const cancelTimer = ports.scheduleExpiry(() => {
        if (correlation === record) forgetReceipt();
      }, record.expiresAt - now());
      if (typeof cancelTimer !== 'function') return fail('BACKUP_UNAVAILABLE');
      record.cancelTimer = cancelTimer;
      if (correlation !== record) {
        cleanup(cancelTimer);
        return fail('BACKUP_CANCELLED');
      }
      assertOperation(operation);
      return record;
    } catch (error) {
      if (correlation === record) forgetReceipt();
      throw error;
    }
  };
  let unsubscribe: () => void;
  try {
    unsubscribe = ports.subscribeInvalidation(cancelAll);
    if (typeof unsubscribe !== 'function') return fail('BACKUP_UNAVAILABLE');
  } catch {
    cancelAll();
    return fail('BACKUP_UNAVAILABLE');
  }
  return Object.freeze({
    begin: () => {
      const operation = beginOperation('reserved');
      try {
        operation.id = nextId();
        assertOperation(operation);
        return operation.id;
      } catch (error) {
        finish(operation);
        throw safeError(error);
      }
    },
    cancel,
    dispose: () => {
      disposed = true;
      cancelAll();
      cleanup(unsubscribe);
    },
    exportEncrypted: async (id, walletPassword, backupPassword) => {
      const operation = reserved(id, 'exporting');
      let ciphertext: Uint8Array | undefined;
      let success = false;
      try {
        const snapshot = await ports.vault.exportBackupSnapshot(
          walletPassword,
          operation.session!
        );
        assertOperation(operation);
        // Freeze one allowlisted snapshot for both encryption and public counts.
        const payload = validateNoteBackupPayload(snapshot);
        ciphertext = await createNoteBackupCodec({
          crypto: ports.crypto,
          assertCurrent: () => assertOperation(operation),
        }).encrypt(payload, backupPassword);
        assertOperation(operation);
        operation.ciphertext = ciphertext;
        operation.id = id;
        operation.noteCount = payload.notes.length;
        operation.createdAt = payload.createdAt;
        operation.phase = 'export';
        const result = Object.freeze({
          id,
          bytes: new Uint8Array(ciphertext),
          noteCount: payload.notes.length,
          createdAt: payload.createdAt,
        });
        success = true;
        return result;
      } catch (error) {
        ciphertext?.fill(0);
        throw failure(operation, error);
      } finally {
        if (running === operation) running = undefined;
        if (!success) finish(operation);
      }
    },
    prepareImport: async (id, ciphertext, backupPassword) => {
      const operation = reserved(id, 'preparing');
      let success = false;
      try {
        forgetReceipt();
        const payload = await createNoteBackupCodec({
          crypto: ports.crypto,
          assertCurrent: () => assertOperation(operation),
        }).decrypt(ciphertext, backupPassword);
        assertOperation(operation);
        operation.entries = payload.notes;
        const plan = await ports.vault.prepareRestore(
          payload.notes,
          operation.session!
        );
        operation.plan = plan;
        assertOperation(operation);
        operation.phase = 'preview';
        const preview = Object.freeze({
          id,
          added: plan.added,
          duplicates: plan.duplicates,
          guarded: plan.guarded,
          expiresAt: operation.expiresAt,
        });
        success = true;
        return preview;
      } catch (error) {
        throw failure(operation, error);
      } finally {
        if (running === operation) running = undefined;
        if (!success) finish(operation);
      }
    },
    commitImport: async (id, walletPassword) => {
      const operation = active;
      let attempted = false;
      if (
        !operation ||
        operation.phase !== 'preview' ||
        !operation.plan ||
        !operation.entries ||
        operation.id !== id
      )
        return fail('BACKUP_STALE');
      try {
        assertOperation(operation);
        const entries = operation.entries;
        // Clear the staging slot synchronously. A second call cannot reuse it.
        operation.entries = undefined;
        operation.phase = 'committing';
        running = operation;
        const record = rememberReceipt(operation);
        attempted = true;
        const receipt = await ports.vault.commitRestore(
          operation.plan!,
          entries,
          walletPassword,
          operation.session!
        );
        assertOperation(operation);
        const result = confirmation(record, receipt);
        if (!result) return fail('BACKUP_COMMIT_UNCONFIRMED');
        return result;
      } catch (error) {
        const reported = failure(operation, error);
        // An operational failure cannot distinguish pre-write rejection from
        // a lost acknowledgment. Only the durable receipt can confirm success.
        if (attempted && reported.code === 'BACKUP_UNAVAILABLE')
          return fail('BACKUP_COMMIT_UNCONFIRMED');
        throw reported;
      } finally {
        if (running === operation) running = undefined;
        finish(operation);
      }
    },
    readCommitReceipt: async (id) => {
      const record = correlation;
      if (!record || record.id !== id) return fail('BACKUP_STALE');
      const operation = beginOperation('reading', record.expiresAt);
      operation.id = id;
      running = operation;
      try {
        synchronous(() => record.base.assertCurrent());
        if (
          operation.base!.keyring !== record.base.keyring ||
          operation.base!.generation !== record.base.generation
        )
          return fail('BACKUP_CANCELLED');
        const receipt = await ports.vault.getRestoreReceipt(operation.session!);
        assertOperation(operation);
        if (correlation !== record) return fail('BACKUP_CANCELLED');
        return receipt ? confirmation(record, receipt) : null;
      } catch (error) {
        throw failure(operation, error);
      } finally {
        if (running === operation) running = undefined;
        finish(operation);
      }
    },
    verifyExport: async (id, readBackBytes, backupPassword) => {
      const operation = active;
      if (
        !operation ||
        operation.phase !== 'export' ||
        operation.id !== id ||
        !operation.ciphertext
      )
        return fail('BACKUP_STALE');
      let success = false;
      let file: Uint8Array | undefined;
      try {
        assertOperation(operation);
        operation.phase = 'verifying';
        running = operation;
        file = copyFile(readBackBytes);
        const expected = operation.ciphertext;
        let difference = file.length ^ expected.length;
        for (let i = 0; i < file.length; i++)
          difference |= file[i] ^ expected[i];
        if (difference) return fail('BACKUP_INVALID_FORMAT');
        const payload = await createNoteBackupCodec({
          crypto: ports.crypto,
          assertCurrent: () => assertOperation(operation),
        }).decrypt(file, backupPassword);
        assertOperation(operation);
        if (
          payload.notes.length !== operation.noteCount ||
          payload.createdAt !== operation.createdAt
        )
          return fail('BACKUP_INVALID_PAYLOAD');
        const result = Object.freeze({
          id,
          noteCount: operation.noteCount!,
          createdAt: operation.createdAt!,
          verified: true as const,
        });
        success = true;
        return result;
      } catch (error) {
        throw failure(operation, error);
      } finally {
        if (running === operation) running = undefined;
        file?.fill(0);
        if (success || !operation.alive) finish(operation);
        else operation.phase = 'export';
      }
    },
  });
}
