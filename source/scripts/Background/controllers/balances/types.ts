import { IKeyringAccountState } from '@sidhujag/sysweb3-keyring';

import type { AssetReadOwner } from '../assets/types';

export interface IEvmBalanceController {
  getEvmBalanceForAccount: (
    currentAccount: IKeyringAccountState,
    owner?: AssetReadOwner
  ) => Promise<string>;
}

export interface ISysBalanceController {
  getSysBalanceForAccount: (
    currentAccount: IKeyringAccountState,
    networkUrl: string,
    owner?: AssetReadOwner
  ) => Promise<string>;
}

export interface IBalancesManagerUtils {
  getBalanceUpdatedForAccount: (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    networkUrl: string,
    owner?: AssetReadOwner
  ) => Promise<string>;
}

export interface IBalancesManager {
  sys: ISysBalanceController;
  utils: IBalancesManagerUtils;
}
