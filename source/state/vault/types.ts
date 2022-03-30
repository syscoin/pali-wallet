import { IWalletState } from '@pollum-io/sysweb3-utils';

export interface IVaultState extends IWalletState {
  activeToken: string;
  isPendingBalances: boolean;
  timer: number;
  trustedApps: string[];
  encryptedMnemonic: string;
}
