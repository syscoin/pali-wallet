import type { NativeSlhDsaAccount } from '../custody/keyringRuntime';
import type { NativeSmartAccountOperation } from './operation';

/** Public management methods only: no signing primitive, SDK or private record. */
export type NativeSlhDsaManagement = Readonly<Pick<NativeSlhDsaAccount,
  'installedKeys' | 'readPrepared' | 'prepareFresh' | 'hydrateInstalled' | 'rebuildInstalled' | 'rebuildPrepared'> & {
  accountAddress: string;
  networkName: string;
  isDeployed: boolean;
  openInstall(keyId: string, signal: AbortSignal, assertCurrent: () => void): Promise<NativeSmartAccountOperation>;
}>;
