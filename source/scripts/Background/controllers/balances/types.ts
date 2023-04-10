import { IPaliAccount } from 'state/vault/types';

export interface IEvmBalanceController {
  getEvmBalanceForAccount: (
    currentAccount: IPaliAccount,
    networkUrl: string
  ) => Promise<string>;
}

export interface ISysBalanceController {
  getSysBalanceForAccount: (
    currentAccount: IPaliAccount,
    networkUrl: string
  ) => Promise<string>;
}

export interface IBalancesManagerUtils {
  getBalanceUpdatedForAccount: (
    currentAccount: IPaliAccount,
    isBitcoinBased: boolean,
    networkUrl: string
  ) => Promise<string>;
}

export interface IBalancesManager {
  evm: IEvmBalanceController;
  sys: ISysBalanceController;
  utils: IBalancesManagerUtils;
}
