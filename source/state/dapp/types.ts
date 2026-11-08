import type { DappGrant } from '../../shared/dappTypes';
export type { DappGrant as IDApp } from '../../shared/dappTypes';

export interface IDAppState {
  /**
   * A list of sites that have been granted permissions to access a user's
   * account information.
   */
  dapps: {
    [host: string]: DappGrant;
  };
  pendingOrigins?: readonly string[];
}
