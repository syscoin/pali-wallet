import { normalizeDappRpcRequest } from '../../../../source/shared/dappRpcReads.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { getPrivacyPool, PRIVACY_CHAIN_ID } from '../../../../source/utils/privacy/registry.ts';
import { prepareSpentCompletion, type SpentCompletionRequest } from '../../../../source/utils/privacy/spentCompletion.ts';
import { prepareWithdrawalRecovery } from '../../../../source/utils/privacy/withdrawalRecovery.ts';
import type { IPrivateVaultHost } from '../../../../source/wallet/privateVault.ts';
import type { EvmTransferReadRpc } from './evmTransferReadRpc.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from './networkContext.ts';

export type NativeNoteMaintenanceProofs = Readonly<Required<Pick<IPrivateVaultHost,
  'prepareCompletionProof' | 'prepareWithdrawalRecovery'>>>;

/** Native transport/lifetime adapter. The extension's shared verifiers own every eligibility rule. */
export function createNativeNoteMaintenanceProofs(options: Readonly<{
  network: NativeNetworkRegistration;
  signal: AbortSignal;
  assertCurrent(): void;
  rpc: Pick<EvmTransferReadRpc, 'retirementRead' | 'dappRequest'>;
}>): NativeNoteMaintenanceProofs {
  const network = snapshotNativeNetwork(options.network);
  if (network.chainId !== String(PRIVACY_CHAIN_ID) ||
      typeof options.rpc?.retirementRead !== 'function' || typeof options.rpc?.dappRequest !== 'function' ||
      typeof options.signal?.aborted !== 'boolean' || typeof options.signal.addEventListener !== 'function' ||
      typeof options.signal.removeEventListener !== 'function')
    throw new Error('privacy_spent_proof_unavailable');
  const { signal, assertCurrent } = options;
  const retirementRead = options.rpc.retirementRead.bind(options.rpc);
  const dappRequest = options.rpc.dappRequest.bind(options.rpc);
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
      let result: unknown;
      switch (method) {
        case 'eth_chainId': case 'eth_getBlockByNumber': case 'eth_getTransactionReceipt':
          result = await retirementRead(method, params, lifetime.signal, current); break;
        case 'eth_call': case 'eth_getTransactionByHash':
          result = await dappRequest(normalizeDappRpcRequest(method, params), lifetime.signal, current); break;
        default: throw new Error('privacy_rpc_unavailable');
      }
      current(); return result;
    } finally {
      signal.removeEventListener('abort', abort); external.removeEventListener('abort', abort); lifetime.abort();
    }
  };
  return Object.freeze<NativeNoteMaintenanceProofs>({
    async prepareCompletionProof(identity, withdrawal, deposit, session) {
      const guard = () => { check(); assertSynchronousEvmFeeGuard(session.assertCurrent); };
      guard();
      if (!['direct', 'relayed'].includes(withdrawal.mode) || withdrawal.phase !== 'submitted' || !withdrawal.transactionHash ||
          withdrawal.mode === 'direct' && (typeof withdrawal.from !== 'string' || typeof withdrawal.nonce !== 'string') ||
          deposit && (deposit.phase !== 'submitted' || !deposit.transactionHash))
        throw new Error('privacy_spent_proof_unavailable');
      const submitted: SpentCompletionRequest['withdrawal'] = withdrawal.mode === 'direct'
        ? { phase: 'submitted', mode: 'direct', transactionHash: withdrawal.transactionHash,
            from: withdrawal.from!, nonce: withdrawal.nonce! }
        : { phase: 'submitted', mode: 'relayed', transactionHash: withdrawal.transactionHash };
      return prepareSpentCompletion({ poolAddress: getPrivacyPool(identity.poolId).address,
        nullifierHash: identity.nullifierHash, withdrawal: submitted,
        ...(deposit ? { deposit: { phase: 'submitted', transactionHash: deposit.transactionHash!, from: deposit.from, nonce: deposit.nonce } } : {}),
        assertCurrent: guard, rpc: read(guard) });
    },
    async prepareWithdrawalRecovery(identity, withdrawal, session) {
      const guard = () => { check(); assertSynchronousEvmFeeGuard(session.assertCurrent); };
      guard();
      return prepareWithdrawalRecovery({ poolAddress: getPrivacyPool(identity.poolId).address,
        nullifierHash: identity.nullifierHash, withdrawal, assertCurrent: guard, rpc: read(guard) });
    },
  });
}
