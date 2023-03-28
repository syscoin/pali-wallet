import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

export interface IDApp {
  accountId: number;
  accountType: KeyringAccountType;
  chain: string;
  chainId: number;
  date: number;
  host: string;
  logo?: string;
}

export interface IDAppState {
  /**
   * A list of sites that have been granted permissions to access a user's
   * account information.
   */
  dapps: {
    [host: string]: IDApp;
  };
}
