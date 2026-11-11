import { findRegisteredEvmNetwork } from '../../../../source/shared/evmNetworks.ts';
import type { NativeNotificationScope } from './types.ts';

/** Matches the existing public readers; no alternate history source is implied. */
export function notificationCapabilities(scope: NativeNotificationScope): Readonly<{ transactions: boolean; guardian: boolean }> {
  if (!('kind' in scope.network) || scope.network.kind !== 'evm')
    return Object.freeze({ transactions: true, guardian: false });
  return Object.freeze({
    transactions: !!findRegisteredEvmNetwork(scope.network)?.network.apiUrl,
    guardian: scope.guardian === true,
  });
}
