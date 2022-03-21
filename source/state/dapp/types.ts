export interface IDappAccounts {
  Ethereum?: string[] | undefined;
  Syscoin?: string[] | undefined;
}
export interface IDAppInfo {
  origin: string;
  logo: string;
  title: string;
  accounts?: IDappAccounts;
}

export interface IDAppState {
  /**
   * Dapps that are currently listening for updates
   */
  listening: {
    [dappId: string]: Array<string>;
  };

  /**
   * A list of sites that have been granted permissions to access a user's
   * account information.
   */
  whitelist: {
    [dappId: string]: IDAppInfo;
  };
}
