/* eslint-disable no-shadow */
export type Message = {
  data: any;
  id: string;
  type: string;
};

export enum HardWallets {
  LEDGER = 'LEDGER',
  TREZOR = 'TREZOR',
}

export enum FaucetChainIds {
  RolluxMainnet = 570,
  RolluxTestnet = 57000,
  nevmTestnet = 5700,
  nevmMainnet = 57,
}

//TODO: addtype for rpc subscription notifications here
export enum PaliEvents {
  accountsChanged = 'pali_accountsChanged',
  addProperty = 'pali_addProperty',
  chainChanged = 'pali_chainChanged',
  isBitcoinBased = 'pali_isBitcoinBased',
  isTestnet = 'pali_isTestnet',
  lockStateChanged = 'pali_unlockStateChanged',
  removeProperty = 'pali_removeProperty',
  xpubChanged = 'pali_xpubChanged',
}
export enum PaliSyscoinEvents {
  blockExplorerChanged = 'pali_blockExplorerChanged',
  lockStateChanged = 'pali_unlockStateChanged',
  xpubChanged = 'pali_xpubChanged',
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

export const blockingRestrictedMethods = Object.freeze([
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_sign',
  'eth_getEncryptionPublicKey',
  'eth_decrypt',
]);

export const restrictedMethods = Object.freeze([
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'personal_ecRecover',
  'personal_sign',
  'eth_getTransactionCount',
  'eth_uninstallFilter',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_getEncryptionPublicKey',
  'eth_mining',
  'wallet_watchAsset',
]);

export const unrestrictedMethods = Object.freeze([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_coinbase',
  'eth_getBlockByHash',
  'eth_getBlockByNumber',
  'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber',
  'eth_getCode',
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_getLogs',
  'eth_getProof',
  'eth_getStorageAt',
  'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getUncleByBlockHashAndIndex',
  'eth_getUncleByBlockNumberAndIndex',
  'eth_getUncleCountByBlockHash',
  'eth_getUncleCountByBlockNumber',
  'eth_getWork',
  'eth_hashrate',
  'eth_newBlockFilter',
  'eth_newFilter',
  'eth_newPendingTransactionFilter',
  'eth_protocolVersion',
  'eth_submitHashrate',
  'eth_submitWork',
  'eth_syncing',
  'metamask_getProviderState',
  'metamask_watchAsset',
  'net_listening',
  'net_peerCount',
  'net_version',
  'web3_clientVersion',
  'web3_sha3',
]);
