/* eslint-disable no-shadow */
export type faucetTxDetailsProps = {
  chainId?: number;
  networkName: string;
  quantity: number;
  smartContract: string;
  token: string;
};

export enum FaucetChainIds {
  RolluxMainnet = 570,
  RolluxTestnet = 57000,
  NevmTestnet = 5700,
  NevmMainnet = 57,
}

export enum FaucetChainSymbols {
  SYS = 'SYS',
  TSYS = 'TSYS',
}

export enum FaucetChainNames {
  ROLLUX = 'Rollux',
  ROLLUX_TESTNET = 'Rollux Testnet',
  SYSCOIN_NEVM = 'Syscoin NEVM',
  SYSCOIN_NEVM_TESTNET = 'Syscoin NEVM Testnet',
}

export enum FaucetStatusResponse {
  ERROR = 'error',
  REQUEST = 'request',
  SUCCESS = 'success',
}
