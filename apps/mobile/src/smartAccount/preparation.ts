import type { SmartAccountPreparationTarget } from '../../../../source/shared/smartAccountPreparation.ts';
import type { NativeConnectionAccount } from '../connections/host.ts';

export type NativeSmartCreationRequest = Readonly<{
  networkId: string;
  label: string;
  target: SmartAccountPreparationTarget;
  externalOwnersAcknowledged: boolean;
}>;

/** Live private capability. Persisted account identity survives its retirement. */
export type NativeSmartCreationAllocation = Readonly<{
  account: NativeConnectionAccount;
  networkId: string;
  chainId: number;
  target: SmartAccountPreparationTarget;
  assertCurrent(): void;
}>;
