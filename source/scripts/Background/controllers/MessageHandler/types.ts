export type Message = {
  data: {
    args: any[];
    asset: string;
    data: string;
    from?: string;
    gas?: string;
    method: string;
    network: string;
    origin?: string;
    to?: string;
    value?: string;
  };
  id: string;
  type: string;
};

export enum SupportedEventTypes {
  accountChanged = 'accountsChanged',
  chainChanged = 'chainChanged', // TODO: implement
  close = 'close',
}

export enum SupportedWalletMethods {
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
}

export const SUPPORTED_CHAINS = ['syscoin', 'ethereum'];
