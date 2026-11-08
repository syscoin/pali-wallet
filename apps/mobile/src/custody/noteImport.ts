import { identifyClassicNote } from '../../../../source/utils/privacy/note.ts';
import type {
  IPrivacyNoteReader,
  IPrivateNoteView,
} from '../../../../source/utils/privacy/privateVaultTypes.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { createNativePrivacyPoolSync } from '../privacy/nativePrivacyPoolSync.ts';

export type NativeImportedNote = Readonly<
  Pick<IPrivateNoteView, 'amount' | 'phase'>
>;
export type NativeNoteImportRuntime = Readonly<{
  importNote(note: string): Promise<NativeImportedNote>;
  dispose(): Promise<void>;
}>;
type Pool = ReturnType<typeof createNativePrivacyPoolSync>;

/** Owns one explicit pool check, while the shared vault owns import and commit. */
export function createNativeNoteImport(
  ports: Readonly<{
    signal: AbortSignal;
    assertCurrent(): void;
    openPool(poolId: PrivacyPoolId, signal: AbortSignal): Promise<Pool>;
    importNote(
      note: string,
      readNote: IPrivacyNoteReader,
      assertCurrent: () => void
    ): Promise<IPrivateNoteView>;
  }>
): NativeNoteImportRuntime {
  const lifetime = new AbortController();
  let pending: Promise<NativeImportedNote> | undefined;
  let pool: Pool | undefined;
  const check = () => {
    if (lifetime.signal.aborted || ports.signal.aborted)
      throw new Error('privacy_cancelled');
    const result: unknown = ports.assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error('privacy_cancelled');
    }
    if (lifetime.signal.aborted || ports.signal.aborted)
      throw new Error('privacy_cancelled');
  };
  const dispose = async () => {
    lifetime.abort();
    ports.signal.removeEventListener('abort', onAbort);
    await pool?.dispose();
    await pending?.catch(() => undefined);
  };
  const onAbort = () => {
    void dispose().catch(() => undefined);
  };
  ports.signal.addEventListener('abort', onAbort, { once: true });

  async function importOwned(note: string): Promise<NativeImportedNote> {
    check();
    const identity = identifyClassicNote(note);
    const opened = await ports.openPool(identity.poolId, lifetime.signal);
    pool = opened;
    try {
      check();
      const status = await opened.refresh();
      check();
      if (status.phase !== 'ready')
        throw new Error('privacy_verification_pending');
      const assertVerified = () => {
        check();
        if (opened.getStatus().phase !== 'ready')
          throw new Error('privacy_verification_pending');
      };
      const result = await ports.importNote(
        note,
        async (requested) => {
          assertVerified();
          if (requested.poolId !== identity.poolId)
            throw new Error('privacy_note_invalid');
          return opened.readNote(requested);
        },
        assertVerified
      );
      check();
      return Object.freeze({ amount: result.amount, phase: result.phase });
    } finally {
      await opened.dispose();
      if (pool === opened) pool = undefined;
    }
  }
  return Object.freeze({
    importNote(note) {
      check();
      if (pending) return Promise.reject(new Error('privacy_busy'));
      pending = importOwned(note).finally(() => {
        pending = undefined;
      });
      return pending;
    },
    dispose,
  });
}
