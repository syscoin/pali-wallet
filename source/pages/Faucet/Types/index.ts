export type faucetTxDetailsProps = {
  icon: string;
  networkName: string;
  quantity: number;
  smartContract: string;
  token: string;
};

// eslint-disable-next-line no-shadow
export enum FaucetChainIds {
  RolluxMainnet = 570,
  RolluxTestnet = 57000,
  nevmTestnet = 5700,
  nevmMainnet = 57,
}

// eslint-disable-next-line no-shadow
export enum FaucetChainSymbols {
  SYS = 'SYS',
  TSYS = 'TSYS',
}

// eslint-disable-next-line no-shadow
export enum FaucetChainNames {
  ROLLUX = 'Rollux',
  ROLLUX_TESTNET = 'Rollux Testnet',
  SYSCOIN_NEVM = 'Syscoin NEVM',
  SYSCOIN_NEVM_TESTNET = 'Syscoin NEVM Testnet',
}

// eslint-disable-next-line no-shadow
export enum FaucetStatusResponse {
  ERROR = 'error',
  REQUEST = 'request',
  SUCCESS = 'success',
}
