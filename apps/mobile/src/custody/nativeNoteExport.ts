import { NOTE_BACKUP_PREVIEW_TTL_MS, NoteBackupServiceError } from '../../../../source/wallet/noteBackupService.ts';
import type { NativeNoteBackupRuntime } from './noteBackupRuntime.ts';
import { assertNoteBackupGuard, eraseNoteBackupBytes } from './noteBackupFileIntake.ts';

type Guard = () => void;
type Destination = {
  readonly token: string;
  readonly assertOwner: Guard;
  readonly expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  assertWallet?: Guard;
  runtime?: NativeNoteBackupRuntime;
  id?: string;
  encrypted?: Uint8Array;
  readback?: Uint8Array;
  writing: boolean;
};
type FileWriter = {
  write(token: string, bytes: Uint8Array): Promise<Uint8Array>;
  revoke(token: string): Promise<void>;
};
const tokenFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Passwords are accepted only by prepare and verify, never by the file writer. */
export function createNativeNoteExport(openRuntime: (guard: Guard) => Promise<NativeNoteBackupRuntime>, files: FileWriter) {
  let current: Destination | undefined;
  let pending = false;
  const revoke = (owned: Destination) => { void Promise.resolve().then(() => files.revoke(owned.token)).catch(() => undefined); };
  const clear = (owned = current) => {
    if (!owned || current !== owned) return;
    current = undefined;
    clearTimeout(owned.timer);
    eraseNoteBackupBytes(owned.encrypted); owned.encrypted = undefined;
    eraseNoteBackupBytes(owned.readback); owned.readback = undefined;
    owned.assertWallet = undefined;
    if (owned.id !== undefined) owned.runtime?.cancel(owned.id);
    revoke(owned);
  };
  const check = (owned: Destination) => {
    if (current !== owned) throw new NoteBackupServiceError('BACKUP_STALE');
    if (performance.now() >= owned.expiresAt) {
      clear(owned);
      throw new NoteBackupServiceError('BACKUP_STALE');
    }
    assertNoteBackupGuard(owned.assertOwner);
    if (owned.assertWallet) assertNoteBackupGuard(owned.assertWallet);
    if (current !== owned) throw new NoteBackupServiceError('BACKUP_CANCELLED');
  };
  return Object.freeze({
    cancel: () => clear(),
    select(token: string, assertOwner: Guard, onExpiry: () => void) {
      if (current || pending) throw new NoteBackupServiceError('BACKUP_BUSY');
      if (typeof token !== 'string' || !tokenFormat.test(token)) throw new NoteBackupServiceError('BACKUP_INVALID_FORMAT');
      const expiresAt = performance.now() + NOTE_BACKUP_PREVIEW_TTL_MS;
      const owned: Destination = { token, assertOwner, expiresAt, writing: false };
      current = owned;
      try {
        check(owned);
        owned.timer = setTimeout(() => {
          if (current === owned) { clear(owned); onExpiry(); }
        }, NOTE_BACKUP_PREVIEW_TTL_MS);
      } catch (error) { clear(owned); throw error; }
    },
    async prepare(backupPassword: string, assertWallet: Guard) {
      const owned = current;
      if (pending) throw new NoteBackupServiceError('BACKUP_BUSY');
      if (!owned || owned.runtime || owned.writing) throw new NoteBackupServiceError('BACKUP_STALE');
      pending = true;
      let output: Uint8Array | undefined;
      owned.assertWallet = assertWallet;
      try {
        const guard = () => check(owned);
        guard();
        const runtime = await openRuntime(guard);
        guard();
        const id = runtime.begin();
        owned.runtime = runtime; owned.id = id;
        const { bytes, noteCount, createdAt } = await runtime.exportEncrypted(id, backupPassword);
        output = bytes;
        guard();
        owned.encrypted = bytes; output = undefined;
        return { noteCount, createdAt };
      } catch (error) {
        if (owned.id !== undefined) owned.runtime?.cancel(owned.id);
        owned.id = undefined; owned.runtime = undefined;
        try { check(owned); } catch { clear(owned); }
        owned.assertWallet = undefined;
        throw error;
      } finally { eraseNoteBackupBytes(output); pending = false; }
    },
    async save() {
      const owned = current;
      if (pending) throw new NoteBackupServiceError('BACKUP_BUSY');
      if (!owned?.encrypted || !owned.runtime || owned.writing) throw new NoteBackupServiceError('BACKUP_STALE');
      check(owned);
      pending = true; owned.writing = true;
      const bytes = owned.encrypted;
      let readback: Uint8Array | undefined;
      try {
        readback = await files.write(owned.token, bytes);
        try { check(owned); } catch { throw new Error('FILE_WRITE_UNCONFIRMED'); }
        if (!(readback instanceof Uint8Array) || readback === bytes || readback.byteLength !== bytes.byteLength)
          throw new Error('FILE_WRITE_UNCONFIRMED');
        owned.readback = readback; readback = undefined;
      } catch (error) {
        clear(owned);
        throw error;
      } finally {
        eraseNoteBackupBytes(bytes); owned.encrypted = undefined; eraseNoteBackupBytes(readback); pending = false;
      }
    },
    async verify(backupPassword: string) {
      const owned = current;
      if (pending) throw new NoteBackupServiceError('BACKUP_BUSY');
      if (!owned?.readback || !owned.runtime || owned.id === undefined) throw new NoteBackupServiceError('BACKUP_STALE');
      check(owned);
      pending = true;
      try {
        const verified = await owned.runtime.verifyExport(owned.id, owned.readback, backupPassword);
        check(owned);
        clear(owned);
        return verified;
      } catch (error) {
        try { check(owned); } catch { clear(owned); }
        throw error;
      } finally { pending = false; }
    },
  });
}
