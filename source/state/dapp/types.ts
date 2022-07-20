export interface IDApp {
  accountId: number;
  logo: string;
  origin: string;
  title: string;
}

export interface IDAppState {
  /**
   * A list of sites that have been granted permissions to access a user's
   * account information.
   */
  dapps: {
    [dappId: string]: IDApp;
  };

  /**
   * Dapps that are currently listening for updates
   */
  listeners: {
    [dappId: string]: Array<string>;
  };
}
