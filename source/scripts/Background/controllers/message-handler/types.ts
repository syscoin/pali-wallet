/* eslint-disable no-shadow */
export type Message = {
  data: any;
  id: string;
  type: string;
};

export enum DAppEvents {
  accountChange = 'accountChange',
  chainChange = 'chainChange',
  connect = 'connect',
  disconnect = 'disconnect',
}

// TODO review dapp methods
export enum DAppMethods {
  getChainId,
  getAccounts,
  getBlockNumber,
  estimateGas,
  sendTransaction,
  signMessage,
  isConnected,
  getNetwork,
  getAddress,
  getBalance,
  setAccount,
}

export const SUPPORTED_CHAINS = ['syscoin', 'ethereum'];
