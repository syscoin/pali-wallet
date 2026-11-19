import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { getPrivacyPool, PRIVACY_CHAIN_ID } from '../../../../source/utils/privacy/registry.ts';
import { prepareSpentCompletion, spentCompletionWithdrawals } from '../../../../source/utils/privacy/spentCompletion.ts';
import type { IPrivateVaultHost } from '../../../../source/wallet/privateVault.ts';
import type { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';

export type NativeNoteMaintenanceProofs = Readonly<Required<Pick<IPrivateVaultHost, 'prepareCompletionProof'>>>;

/** Native transport/lifetime adapter. The shared completion verifier owns eligibility. */
export function createNativeNoteMaintenanceProofs(options: Readonly<{
  network: NativeNetworkRegistration;
  signal: AbortSignal;
  assertCurrent(): void;
  rpc: Pick<EvmTransferReadRpc, 'noteMaintenanceRead'>;
}>): NativeNoteMaintenanceProofs {
  const network = snapshotNativeNetwork(options.network);
  if (network.chainId !== String(PRIVACY_CHAIN_ID) ||
      typeof options.rpc?.noteMaintenanceRead !== 'function' ||
      typeof options.signal?.aborted !== 'boolean' || typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
    throw new Error('privacy_spent_proof_unavailable');
  const { signal, assertCurrent } = options;
  const noteMaintenanceRead = options.rpc.noteMaintenanceRead.bind(options.rpc);
  const check = () => {
    assertSynchronousEvmFeeGuard(assertCurrent);
    if (signal.aborted) throw new Error('privacy_vault_session_changed');
  };
  check();
  const read = (guard: () => void) => async (method: string, params: unknown[], external: AbortSignal) => {
    const lifetime = new AbortController();
    const abort = () => lifetime.abort();
    signal.addEventListener('abort', abort, { once: true });
    external.addEventListener('abort', abort, { once: true });
    const current = () => { check(); guard(); if (external.aborted || lifetime.signal.aborted) throw new Error('privacy_vault_session_changed'); };
    try {
      current();
      const result = await noteMaintenanceRead(method, params, lifetime.signal, current);
      current(); return result;
    } finally {
      signal.removeEventListener('abort', abort); external.removeEventListener('abort', abort); lifetime.abort();
    }
  };
  return Object.freeze<NativeNoteMaintenanceProofs>({
    async prepareCompletionProof(identity, withdrawal, session, selection) {
      const guard = () => { check(); assertSynchronousEvmFeeGuard(session.assertCurrent); };
      guard();
      return prepareSpentCompletion({ poolAddress: getPrivacyPool(identity.poolId).address,
        nullifierHash: identity.nullifierHash, ...spentCompletionWithdrawals(withdrawal, selection),
        assertCurrent: guard, rpc: read(guard) });
    },
  });
}
