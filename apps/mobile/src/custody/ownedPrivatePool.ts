import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeApproval.ts';
import type { IPrivacyNoteReader } from '../../../../source/utils/privacy/privateVaultTypes.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
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
  return Object.freeze({
    poolId,
    readNote,
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
