import { NoteBackupServiceError, type INoteBackupPreview } from '../../../../source/wallet/noteBackupService.ts';
import type { NativeNoteBackupRuntime } from './noteBackupRuntime.ts';
import { createNoteBackupFileIntake } from './noteBackupFileIntake.ts';

type Guard = () => void;
type RestorePlan = {
  readonly runtime: NativeNoteBackupRuntime;
  readonly preview: INoteBackupPreview;
  expiry: ReturnType<typeof setTimeout> | undefined;
};

/** Each instance belongs to one mounted restore route and never stores a password. */
export function createNativeNoteRestore(openRuntime: (assertOwner: Guard) => Promise<NativeNoteBackupRuntime>) {
  const file = createNoteBackupFileIntake();
  let revision = 0;
  let plan: RestorePlan | undefined;
  let committing = false;
  const retirePlan = (owned: RestorePlan | undefined) => {
    if (!owned || plan !== owned) return;
    plan = undefined;
    clearTimeout(owned.expiry);
    owned.runtime.cancel(owned.preview.id);
  };
  const cancel = () => {
    revision++;
    file.cancel();
    retirePlan(plan);
  };
  return Object.freeze({
    cancel,
    hasFile: file.hasFile,
    select(pick: (assertCurrent: Guard) => Promise<Uint8Array | null>, assertOwner: Guard, onExpiry?: () => void) {
      if (plan || committing) return Promise.reject(new NoteBackupServiceError('BACKUP_BUSY'));
      return file.select(pick, assertOwner, onExpiry);
    },
    async prepare(password: string, assertWallet: Guard, onExpiry: () => void) {
      const captured = revision;
      let runtime: NativeNoteBackupRuntime | undefined;
      let id: string | undefined;
      let owned: RestorePlan | undefined;
      const check = () => {
        if (captured !== revision) throw new NoteBackupServiceError('BACKUP_CANCELLED');
        assertWallet();
        if (captured !== revision) throw new NoteBackupServiceError('BACKUP_CANCELLED');
      };
      try {
        const preview = await file.open(check, async (bytes, guard) => {
          runtime = await openRuntime(guard);
          guard();
          id = runtime.begin();
          const result = await runtime.prepareImport(id, bytes, password);
          guard();
          owned = { runtime, preview: result, expiry: undefined };
          plan = owned;
          return result;
        });
        check();
        const accepted = owned!;
        accepted.expiry = setTimeout(() => {
          if (plan !== accepted || committing) return;
          retirePlan(accepted);
          onExpiry();
        }, Math.max(0, preview.expiresAt - performance.now()));
        return preview;
      } catch (error) {
        if (owned) retirePlan(owned);
        else if (id !== undefined) runtime?.cancel(id);
        throw error;
      }
    },
    async restore(id: string, password: string) {
      if (committing) throw new NoteBackupServiceError('BACKUP_BUSY');
      const owned = plan;
      if (!owned || owned.preview.id !== id) throw new NoteBackupServiceError('BACKUP_STALE');
      if (performance.now() >= owned.preview.expiresAt) {
        retirePlan(owned);
        throw new NoteBackupServiceError('BACKUP_STALE');
      }
      committing = true;
      try {
        const receipt = await owned.runtime.commitImport(id, password);
        if (plan !== owned) throw new NoteBackupServiceError('BACKUP_CANCELLED');
        return receipt;
      }
      finally { retirePlan(owned); committing = false; }
    },
  });
}
