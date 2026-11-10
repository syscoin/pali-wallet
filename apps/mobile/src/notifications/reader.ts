import { getAddress } from 'ethers/address';
import { keccak256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { activityNotificationScopeKey, type ActivityNotificationBaseline, type ActivityNotificationScope } from '../../../../source/shared/activityNotifications.ts';
import { assertPublicWatchOnlyIdentifier } from '../../../../source/utils/watchOnlyIdentifier.ts';
import { ActivityExplorerReader } from '../activity/explorerReader.ts';
import { createActivityReadScope } from '../activity/types.ts';
import { createUtxoActivityReader } from '../core/utxoActivity.ts';
import { normalizeUtxoAddress } from '../core/utxoAddresses.ts';
import { projectUtxoRegistration, type UtxoRegistration } from '../core/utxoNetworks.ts';
import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import { snapshotNativeNetwork, type NativeNetworkRegistration } from '../custody/networkContext.ts';
import { walletFetch } from '../platform/http';
import type { NativeNotificationScope } from './types.ts';

export function isEvmScope(scope: NativeNotificationScope): scope is NativeNotificationScope & { network: NativeNetworkRegistration } {
  return 'kind' in scope.network && scope.network.kind === 'evm';
}
export function normalizeNotificationScope(input: NativeNotificationScope): NativeNotificationScope {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(input.id) ||
      typeof input.accountId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(input.accountId) ||
      typeof input.accountType !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input.accountType) ||
      typeof input.accountAddress !== 'string' || (input.guardian !== undefined && typeof input.guardian !== 'boolean')) throw new Error('Invalid alert account');
  const base = { id: input.id, accountId: input.accountId, accountType: input.accountType };
  if (isEvmScope(input)) {
    if (input.identifier !== undefined || input.isAccount !== undefined) throw new Error('Invalid EVM alert account');
    return Object.freeze({ ...base, accountAddress: getAddress(input.accountAddress), network: snapshotNativeNetwork(input.network), guardian: input.guardian === true });
  }
  const network = projectUtxoRegistration(input.network);
  const accountAddress = normalizeUtxoAddress(input.accountAddress, network);
  if (input.guardian === true || typeof input.isAccount !== 'boolean' || typeof input.identifier !== 'string') throw new Error('Invalid UTXO alert account');
  if (input.isAccount) assertPublicWatchOnlyIdentifier(input.identifier);
  else if (normalizeUtxoAddress(input.identifier, network) !== accountAddress) throw new Error('Changed UTXO alert account');
  const { id, chainId, slip44, backendChain, endpoint, name, explorer } = network;
  return Object.freeze({ ...base, accountAddress, network: { id, chainId, slip44, backendChain, endpoint, name, explorer }, identifier: input.identifier, isAccount: input.isAccount });
}
export function notificationFactScope(scope: NativeNotificationScope): ActivityNotificationScope {
  return { accountId: scope.accountId, accountType: scope.accountType, accountAddress: scope.accountAddress,
    chainId: String(scope.network.chainId), networkType: isEvmScope(scope) ? 'evm' : 'utxo',
    networkKey: isEvmScope(scope) ? scope.network.registrationHash : keccak256(toUtf8Bytes(JSON.stringify(scope.network))) };
}
/** Reuses the wallet's existing bounded explorer, Blockbook and guardian RPC readers. */
export function createNotificationReader() {
  const explorer = new ActivityExplorerReader(walletFetch);
  const utxo = createUtxoActivityReader({ fetch: walletFetch, timeoutMs: 10000 });
  return async (scope: NativeNotificationScope, previous: ActivityNotificationBaseline | null, signal: AbortSignal, guard: () => void) => {
    guard();
    if (!isEvmScope(scope)) {
      const network = projectUtxoRegistration(scope.network as UtxoRegistration);
      const page = await utxo.readPage({ context: { accountId: scope.accountId, networkId: network.id, address: scope.accountAddress, generation: 0 },
        registration: network, identifier: scope.identifier!, isAccount: scope.isAccount!, assertCurrent: guard }, { page: 1 }, signal);
      guard();
      return { transactions: page.rows, historyReadSucceeded: true };
    }
    const key = keccak256(toUtf8Bytes(activityNotificationScopeKey(notificationFactScope(scope))));
    const historyScope = createActivityReadScope(key, scope.accountAddress, scope.network);
    const history = historyScope.apiUrl ? Promise.all([
      explorer.page(historyScope, 'txlist', 1, signal, guard),
      explorer.page(historyScope, 'tokentx', 1, signal, guard),
    ]).then((pages) => pages.flat().map((row) => row.indexed)) : Promise.reject(new Error('No registered activity explorer'));
    // This class is the existing read-only endpoint adapter; no authority, vault or signer is constructed.
    const reader = scope.guardian ? new EvmTransferReadRpc(scope.network, { fetch: walletFetch, timeoutMs: 10000 }) : null;
    const operationId = previous?.guardian?.trackedOperationId;
    const guardian = reader ? (operationId ? reader.readGuardianRecoveryOperation(scope.accountAddress, operationId, signal, guard)
      : reader.readGuardianRecoveryStatus(scope.accountAddress, signal, guard)) : Promise.resolve(null);
    const [historyResult, guardianResult] = await Promise.allSettled([history, guardian]);
    guard();
    if (historyResult.status === 'rejected' && guardianResult.status === 'rejected') throw new Error('Alert observations unavailable');
    const guardianValue = guardianResult.status === 'fulfilled' ? guardianResult.value : null;
    return { transactions: historyResult.status === 'fulfilled' ? historyResult.value : [], historyReadSucceeded: historyResult.status === 'fulfilled',
      ...(guardianValue?.status === 'observed' ? { guardianObservation: guardianValue.observation } : {}) };
  };
}
