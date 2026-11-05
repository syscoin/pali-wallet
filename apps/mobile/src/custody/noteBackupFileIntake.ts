import { inspectNoteBackupHeader } from '../../../../source/wallet/noteBackup.ts';
import {
  NOTE_BACKUP_PREVIEW_TTL_MS,
  NoteBackupServiceError,
} from '../../../../source/wallet/noteBackupService.ts';

type Guard = () => void;
type Ticket = {
  readonly assertOwner: Guard;
  readonly expiresAt: number;
  readonly onExpiry: () => void;
  cancelTimer?: () => void;
  bytes?: Uint8Array;
};
type Clock = {
  now(): number;
  schedule(expire: () => void, milliseconds: number): () => void;
};
const clock: Clock = {
  now: () => performance.now(),
  schedule(expire, milliseconds) {
    const timer = setTimeout(expire, milliseconds);
    return () => clearTimeout(timer);
  },
};

const fail = (code: ConstructorParameters<typeof NoteBackupServiceError>[0]): never => {
  throw new NoteBackupServiceError(code);
};
export const assertNoteBackupGuard = (guard: Guard) => {
  const result: unknown = guard();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).catch(() => undefined);
  fail('BACKUP_CANCELLED');
};
export const eraseNoteBackupBytes = (bytes: unknown) => {
  try {
    if (bytes instanceof Uint8Array) Uint8Array.prototype.fill.call(bytes, 0);
  } catch { /* A detached buffer no longer has bytes to retain. */ }
};

/**
 * Only the encrypted file may survive a system picker locking the wallet.
 * The selection belongs to the current controller/route owner, independent of
 * that owner's unlock session. Opening it requires a newly current wallet
 * session. Neither an unlock grant nor either password is held here.
 */
export function createNoteBackupFileIntake(time: Clock = clock) {
  let ticket: Ticket | undefined;
  let pending = false;
  let lastNow = -1;
  const now = () => {
    const value = time.now();
    if (!Number.isFinite(value) || value < 0 || value < lastNow ||
        value > Number.MAX_SAFE_INTEGER - NOTE_BACKUP_PREVIEW_TTL_MS)
      return fail('BACKUP_UNAVAILABLE');
    return (lastNow = value);
  };
  const discard = (owned: Ticket | undefined) => {
    if (!owned || ticket !== owned) return;
    ticket = undefined;
    eraseNoteBackupBytes(owned.bytes);
    owned.bytes = undefined;
    try { owned.cancelTimer?.(); } catch { /* Ticket is already retired. */ }
  };
  const expire = (owned: Ticket) => {
    if (ticket !== owned) return;
    discard(owned);
    owned.onExpiry();
  };
  const check = (owned: Ticket) => {
    if (ticket !== owned) fail('BACKUP_CANCELLED');
    if (now() >= owned.expiresAt) {
      expire(owned);
      fail('BACKUP_STALE');
    }
    assertNoteBackupGuard(owned.assertOwner);
    if (ticket !== owned) fail('BACKUP_CANCELLED');
  };
  return Object.freeze({
    cancel: () => discard(ticket),
    hasFile() {
      const owned = ticket;
      if (!owned?.bytes) return false;
      try {
        check(owned);
        return true;
      } catch {
        discard(owned);
        return false;
      }
    },
    async select(pick: (assertCurrent: Guard) => Promise<Uint8Array | null>, assertOwner: Guard, onExpiry: () => void = () => undefined) {
      if (pending || ticket) return fail('BACKUP_BUSY');
      pending = true;
      let owned: Ticket | undefined;
      let bytes: Uint8Array | null = null;
      try {
        const start = now();
        const selection: Ticket = { assertOwner, expiresAt: start + NOTE_BACKUP_PREVIEW_TTL_MS, onExpiry };
        ticket = owned = selection;
        const assertCurrent = () => check(selection);
        selection.cancelTimer = time.schedule(() => expire(selection), NOTE_BACKUP_PREVIEW_TTL_MS);
        assertCurrent();
        bytes = await pick(assertCurrent);
        assertCurrent();
        if (bytes === null) { discard(selection); return false; }
        try { inspectNoteBackupHeader(bytes); } catch { return fail('BACKUP_INVALID_FORMAT'); }
        selection.bytes = bytes;
        bytes = null;
        return true;
      } catch (error) {
        discard(owned);
        throw error;
      } finally {
        eraseNoteBackupBytes(bytes);
        pending = false;
      }
    },
    async open<T>(assertWallet: Guard, prepare: (bytes: Uint8Array, assertCurrent: Guard) => Promise<T>): Promise<T> {
      if (pending) return fail('BACKUP_BUSY');
      const owned = ticket;
      if (!owned?.bytes) return fail('BACKUP_STALE');
      let handedOff = false;
      const assertCurrent = () => {
        if (handedOff) {
          assertNoteBackupGuard(owned.assertOwner);
          assertNoteBackupGuard(assertWallet);
        } else {
          check(owned);
          assertNoteBackupGuard(assertWallet);
          check(owned);
        }
      };
      pending = true;
      try {
        assertCurrent();
        const prepared = await prepare(owned.bytes, assertCurrent);
        assertCurrent();
        // The shared service now owns the verified preview and its own expiry.
        // It must still observe route and wallet revocation after file release.
        handedOff = true;
        discard(owned);
        return prepared;
      } catch (error) {
        // The shared service made no preview or write on a failed file open.
        // Keep only ciphertext so the user can retry that password in place.
        if (error instanceof NoteBackupServiceError && error.code === 'BACKUP_OPEN_FAILED') {
          try { assertCurrent(); } catch (revoked) { discard(owned); throw revoked; }
        } else discard(owned);
        throw error;
      } finally {
        pending = false;
      }
    },
  });
}
