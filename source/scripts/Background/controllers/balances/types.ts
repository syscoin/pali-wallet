import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

export interface IEvmBalanceController {
  getEvmBalanceForAccount: (
    address: string,
    networkUrl: string
  ) => Promise<string>;
}

export interface ISysBalanceController {
  getSysBalanceForAccount: (
    xpub: string,
    networkUrl: string
  ) => Promise<string>;
}

export interface IBalancesManagerUtils {
  getBalanceUpdatedForAccount: (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    networkUrl: string
  ) => Promise<string>;
}

export interface IBalancesManager {
  evm: IEvmBalanceController;
  sys: ISysBalanceController;
  utils: IBalancesManagerUtils;
}
