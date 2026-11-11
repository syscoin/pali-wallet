import type { ISmartAccountMetadata } from '../../../../source/types/network.ts';
import type { CustomValidatorPreflightResult } from '../../../../source/utils/smartAccount/custom.ts';
import type { NativeSmartAccountOperation } from './operation.ts';
import type { NativeSmartModuleDraft } from './modules.ts';

/** Public presentation adapter. Custody resolves every command and signing owner. */
export type NativeSmartModuleManagement = Readonly<{
  accountAddress: string;
  networkName: string;
  passkeysAvailable: boolean;
  openPasskey(recreate: boolean, signal: AbortSignal, assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
  read(): Promise<ISmartAccountMetadata>;
  preflightCustom(address: string): Promise<CustomValidatorPreflightResult>;
  openChange(
    draft: NativeSmartModuleDraft,
    signal: AbortSignal,
    assertCurrent: () => void
  ): Promise<NativeSmartAccountOperation>;
}>;
