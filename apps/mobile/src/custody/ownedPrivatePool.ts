import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeApproval.ts';
import type { IPrivacyNoteReader } from '../../../../source/utils/privacy/privateVaultTypes.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { IPrivacySnapshotReader } from '../../../../source/utils/privacy/trustedSnapshot.ts';
import type { createNativePrivacyPoolSync } from '../privacy/nativePrivacyPoolSync.ts';

type Pool = ReturnType<typeof createNativePrivacyPoolSync>;
export async function openOwnedPrivatePool(
  poolId: PrivacyPoolId,
  open: (poolId: PrivacyPoolId, signal: AbortSignal) => Promise<Pool>,
  signal: AbortSignal,
  assertCurrent: () => void
) {
  let closed = false;
  let closing: Promise<void> | undefined;
  const check = () => {
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (closed || signal.aborted) throw new Error('privacy_cancelled');
  };
  check();
  const pool = await open(poolId, signal);
  try {
    check();
  } catch (error) {
    await pool.dispose();
    throw error;
  }
  const readNote: IPrivacyNoteReader = async (identity) => {
    check();
    if (identity.poolId !== poolId) throw new Error('privacy_note_invalid');
    const result = await pool.readNote(identity);
    check();
    return result;
  };
  const readSnapshot: IPrivacySnapshotReader = async (id) => {
    check();
    if (id !== poolId) throw new Error('privacy_note_invalid');
    const access = await pool.readSnapshot(id);
    check();
    const checkSnapshotOwner = () => {
      check();
      // The pool's local read guard also binds its captured service origin.
      pool.getStatus();
      check();
    };
    const assertSnapshotCurrent = (snapshot: typeof access.snapshot) => {
      checkSnapshotOwner();
      assertSynchronousEvmFeeGuard(() =>
        access.assertSnapshotCurrent(snapshot)
      );
      checkSnapshotOwner();
    };
    return Object.freeze({
      snapshot: access.snapshot,
      assertSnapshotCurrent,
      async getPath(index: number) {
        assertSnapshotCurrent(access.snapshot);
        const path = await access.getPath(index);
        assertSnapshotCurrent(access.snapshot);
        return path;
      },
      ...(access.waitForScheduledRefresh
        ? {
            async waitForScheduledRefresh() {
              checkSnapshotOwner();
              const refreshed = await access.waitForScheduledRefresh!();
              checkSnapshotOwner();
              return refreshed;
            },
          }
        : {}),
    });
  };
  return Object.freeze({
    poolId,
    readNote,
    readSnapshot,
    async refresh() {
      check();
      const result = await pool.refresh();
      check();
      return result;
    },
    dispose() {
      closed = true;
      closing ??= Promise.resolve().then(() => pool.dispose());
      return closing;
    },
  });
}
