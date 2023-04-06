export interface IEvmBalanceController {
  getEvmBalanceForAccount: (
    address: string,
    networkUrl: string
  ) => Promise<string>;
}

export interface ISysBalanceController {
  getSysBalanceForAccount: (
    networkUrl: string,
    xpub: string
  ) => Promise<string>;
}

export interface IBalancesManager {
  evm: IEvmBalanceController;
  sys: ISysBalanceController;
}
