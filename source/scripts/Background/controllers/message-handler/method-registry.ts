import {
  MethodRegistry,
  MethodHandlerType,
  NetworkRequirement,
  MethodRoute,
  IMethodConfig,
} from './types';

/**
 * The single source of truth for all method configurations.
 * This registry defines how each method should be handled throughout the system.
 */
/* eslint-disable camelcase */
// Standard blockchain/wallet API method names use underscore convention
export const METHOD_REGISTRY: MethodRegistry = {
  // ===== Internal Methods =====
  ENABLE: {
    name: 'ENABLE',
    handlerType: MethodHandlerType.Internal,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: false, // This IS the connection method
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.Connect,
    popupEventName: 'connect',
  },

  DISABLE: {
    name: 'DISABLE',
    handlerType: MethodHandlerType.Internal,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  IS_UNLOCKED: {
    name: 'IS_UNLOCKED',
    handlerType: MethodHandlerType.Internal,
    requiresTabId: false,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  // ===== Wallet Methods =====
  wallet_isLocked: {
    name: 'wallet_isLocked',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_isConnected: {
    name: 'wallet_isConnected',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_getChangeAddress: {
    name: 'wallet_getChangeAddress',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: true,
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: false,
    requiresActiveAccount: true,
  },

  wallet_getAccount: {
    name: 'wallet_getAccount',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_getBalance: {
    name: 'wallet_getBalance',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    requiresActiveAccount: true,
  },

  wallet_getNetwork: {
    name: 'wallet_getNetwork',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_getPublicKey: {
    name: 'wallet_getPublicKey',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    requiresActiveAccount: true,
  },

  wallet_getAddress: {
    name: 'wallet_getAddress',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    requiresActiveAccount: true,
  },

  wallet_getTokens: {
    name: 'wallet_getTokens',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Read-only - just token metadata
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_estimateFee: {
    name: 'wallet_estimateFee',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Read-only - just fee estimates
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_changeAccount: {
    name: 'wallet_changeAccount',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.ChangeAccount,
    popupEventName: 'accountsChanged',
  },

  wallet_requestPermissions: {
    name: 'wallet_requestPermissions',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.ChangeAccount,
    popupEventName: 'requestPermissions',
  },

  wallet_getPermissions: {
    name: 'wallet_getPermissions',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: true,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    requiresActiveAccount: true,
  },

  wallet_revokePermissions: {
    name: 'wallet_revokePermissions',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  wallet_watchAsset: {
    name: 'wallet_watchAsset',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.WatchAsset,
    popupEventName: 'wallet_watchAsset',
  },

  wallet_addEthereumChain: {
    name: 'wallet_addEthereumChain',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.AddEthChain,
    popupEventName: 'wallet_addEthereumChain',
  },

  wallet_switchEthereumChain: {
    name: 'wallet_switchEthereumChain',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.SwitchEthChain,
    popupEventName: 'wallet_switchEthereumChain',
  },

  wallet_getProviderState: {
    name: 'wallet_getProviderState',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    cacheKey: 'providerState',
    cacheTTL: 10000, // 10 seconds
  },

  wallet_getSysProviderState: {
    name: 'wallet_getSysProviderState',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    cacheKey: 'sysProviderState',
    cacheTTL: 10000, // 10 seconds
  },

  wallet_getSysAssetMetadata: {
    name: 'wallet_getSysAssetMetadata',
    handlerType: MethodHandlerType.Wallet,
    requiresTabId: true,
    requiresAuth: false, // Read-only - just asset metadata
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  // ===== Ethereum Methods =====
  eth_chainId: {
    name: 'eth_chainId',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    cacheKey: 'chainId',
    cacheTTL: 10000, // 10 seconds
  },

  eth_accounts: {
    name: 'eth_accounts',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    returnsArray: true,
    cacheKey: 'accounts',
    cacheTTL: 10000, // 10 seconds
  },

  eth_requestAccounts: {
    name: 'eth_requestAccounts',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.Connect,
    popupEventName: 'connect',
    returnsArray: true,
  },

  eth_sendTransaction: {
    name: 'eth_sendTransaction',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.SendEthTx,
    popupEventName: 'eth_sendTransaction',
    isBlocking: true,
  },

  eth_sign: {
    name: 'eth_sign',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.EthSign,
    popupEventName: 'eth_sign',
    isBlocking: true,
  },

  personal_sign: {
    name: 'personal_sign',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.EthSign,
    popupEventName: 'personal_sign',
    isBlocking: true,
  },

  eth_signTypedData: {
    name: 'eth_signTypedData',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.EthSign,
    popupEventName: 'eth_signTypedData',
    isBlocking: true,
  },

  eth_signTypedData_v3: {
    name: 'eth_signTypedData_v3',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.EthSign,
    popupEventName: 'eth_signTypedData_v3',
    isBlocking: true,
  },

  eth_signTypedData_v4: {
    name: 'eth_signTypedData_v4',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.EthSign,
    popupEventName: 'eth_signTypedData_v4',
    isBlocking: true,
  },

  // Non-blocking ETH methods (most web3 calls)
  eth_getBalance: {
    name: 'eth_getBalance',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getCode: {
    name: 'eth_getCode',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getTransactionCount: {
    name: 'eth_getTransactionCount',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getTransactionReceipt: {
    name: 'eth_getTransactionReceipt',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_call: {
    name: 'eth_call',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_estimateGas: {
    name: 'eth_estimateGas',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_gasPrice: {
    name: 'eth_gasPrice',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_blockNumber: {
    name: 'eth_blockNumber',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  net_version: {
    name: 'net_version',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    cacheKey: 'netVersion',
    cacheTTL: 10000, // 10 seconds
  },

  // Additional unrestricted Ethereum methods
  eth_sendRawTransaction: {
    name: 'eth_sendRawTransaction',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
    isBlocking: false,
  },

  personal_ecRecover: {
    name: 'personal_ecRecover',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_coinbase: {
    name: 'eth_coinbase',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getBlockByHash: {
    name: 'eth_getBlockByHash',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getBlockByNumber: {
    name: 'eth_getBlockByNumber',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getBlockTransactionCountByHash: {
    name: 'eth_getBlockTransactionCountByHash',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getBlockTransactionCountByNumber: {
    name: 'eth_getBlockTransactionCountByNumber',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getFilterChanges: {
    name: 'eth_getFilterChanges',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: false,
  },

  eth_getFilterLogs: {
    name: 'eth_getFilterLogs',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getLogs: {
    name: 'eth_getLogs',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getProof: {
    name: 'eth_getProof',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getStorageAt: {
    name: 'eth_getStorageAt',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getTransactionByBlockHashAndIndex: {
    name: 'eth_getTransactionByBlockHashAndIndex',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getTransactionByBlockNumberAndIndex: {
    name: 'eth_getTransactionByBlockNumberAndIndex',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getTransactionByHash: {
    name: 'eth_getTransactionByHash',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getUncleByBlockHashAndIndex: {
    name: 'eth_getUncleByBlockHashAndIndex',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getUncleByBlockNumberAndIndex: {
    name: 'eth_getUncleByBlockNumberAndIndex',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getUncleCountByBlockHash: {
    name: 'eth_getUncleCountByBlockHash',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getUncleCountByBlockNumber: {
    name: 'eth_getUncleCountByBlockNumber',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getWork: {
    name: 'eth_getWork',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_hashrate: {
    name: 'eth_hashrate',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_mining: {
    name: 'eth_mining',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_newBlockFilter: {
    name: 'eth_newBlockFilter',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: false,
  },

  eth_newFilter: {
    name: 'eth_newFilter',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: false,
  },

  eth_newPendingTransactionFilter: {
    name: 'eth_newPendingTransactionFilter',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: false,
  },

  eth_protocolVersion: {
    name: 'eth_protocolVersion',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_submitHashrate: {
    name: 'eth_submitHashrate',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_submitWork: {
    name: 'eth_submitWork',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_syncing: {
    name: 'eth_syncing',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_uninstallFilter: {
    name: 'eth_uninstallFilter',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: false,
  },

  eth_feeHistory: {
    name: 'eth_feeHistory',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  net_listening: {
    name: 'net_listening',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  net_peerCount: {
    name: 'net_peerCount',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  web3_clientVersion: {
    name: 'web3_clientVersion',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  web3_sha3: {
    name: 'web3_sha3',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  eth_getEncryptionPublicKey: {
    name: 'eth_getEncryptionPublicKey',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.EncryptKey,
    popupEventName: 'eth_getEncryptionPublicKey',
    isBlocking: true,
  },

  eth_decrypt: {
    name: 'eth_decrypt',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.EVM,
    hasPopup: true,
    popupRoute: MethodRoute.DecryptKey,
    popupEventName: 'eth_decrypt',
    isBlocking: true,
  },

  eth_changeUTXOEVM: {
    name: 'eth_changeUTXOEVM',
    handlerType: MethodHandlerType.Eth,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.SwitchUtxoEvm,
    popupEventName: 'change_UTXOEVM',
  },

  // ===== Syscoin Methods =====
  sys_requestAccounts: {
    name: 'sys_requestAccounts',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false, // Does not require connection - gets UTXO address from vault
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: false, // No popup needed - just returns UTXO address
    returnsArray: true,
  },

  sys_getTransactions: {
    name: 'sys_getTransactions',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_transaction: {
    name: 'sys_transaction',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: false,
  },

  sys_getAccount: {
    name: 'sys_getAccount',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_isConnected: {
    name: 'sys_isConnected',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_getNetwork: {
    name: 'sys_getNetwork',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_sendTransaction: {
    name: 'sys_sendTransaction',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: true,
    popupRoute: MethodRoute.SendNTokenTx,
    popupEventName: 'sys_sendTransaction',
    isBlocking: true,
  },

  sys_signMessage: {
    name: 'sys_signMessage',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: true,
    popupRoute: MethodRoute.EthSign,
    popupEventName: 'sys_signMessage',
    isBlocking: true,
  },

  sys_getPublicKey: {
    name: 'sys_getPublicKey',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_getChangeAddress: {
    name: 'sys_getChangeAddress',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: true,
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: false,
  },

  sys_sign: {
    name: 'sys_sign',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: true,
    popupRoute: MethodRoute.SignPsbt,
    popupEventName: 'txSign',
    isBlocking: true,
  },

  sys_signAndSend: {
    name: 'sys_signAndSend',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: false,
    networkRequirement: NetworkRequirement.UTXO,
    hasPopup: true,
    popupRoute: MethodRoute.SignTx,
    popupEventName: 'txSignAndSend',
    isBlocking: true,
  },

  sys_isNFT: {
    name: 'sys_isNFT',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_isValidSYSAddress: {
    name: 'sys_isValidSYSAddress',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false,
    requiresConnection: false,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: false,
  },

  sys_changeUTXOEVM: {
    name: 'sys_changeUTXOEVM',
    handlerType: MethodHandlerType.Sys,
    requiresTabId: true,
    requiresAuth: false, // Popup handles auth
    requiresConnection: true,
    allowHardwareWallet: true,
    networkRequirement: NetworkRequirement.Any,
    hasPopup: true,
    popupRoute: MethodRoute.SwitchUtxoEvm,
    popupEventName: 'change_UTXOEVM',
  },
};
/* eslint-enable camelcase */

// Helper function to get method config
export function getMethodConfig(method: string): IMethodConfig | undefined {
  return METHOD_REGISTRY[method];
}

// Helper function to check if method requires authentication
export function methodRequiresAuth(method: string): boolean {
  const config = getMethodConfig(method);
  return config?.requiresAuth ?? false;
}

// Helper function to check if method requires connection
export function methodRequiresConnection(method: string): boolean {
  const config = getMethodConfig(method);
  return config?.requiresConnection ?? false;
}

// Helper function to check if method is allowed for hardware wallets
export function isMethodAllowedForHardwareWallet(method: string): boolean {
  const config = getMethodConfig(method);
  return config?.allowHardwareWallet ?? true;
}

// Helper function to get all methods of a specific type
export function getMethodsByHandlerType(type: MethodHandlerType): string[] {
  return Object.entries(METHOD_REGISTRY)
    .filter(([, config]) => config.handlerType === type)
    .map(([method]) => method);
}

// Helper function to get all blocking methods
export function getBlockingMethods(): string[] {
  return Object.entries(METHOD_REGISTRY)
    .filter(([, config]) => config.isBlocking)
    .map(([method]) => method);
}

// Helper function to get methods that require specific network type
export function getMethodsByNetworkRequirement(
  requirement: NetworkRequirement
): string[] {
  return Object.entries(METHOD_REGISTRY)
    .filter(([, config]) => config.networkRequirement === requirement)
    .map(([method]) => method);
}

// Helper function to check if method has popup
export function methodHasPopup(method: string): boolean {
  const config = getMethodConfig(method);
  return config?.hasPopup ?? false;
}

// Helper function to get popup configuration
export function getMethodPopupConfig(
  method: string
): { eventName?: string; route?: MethodRoute } | null {
  const config = getMethodConfig(method);
  if (!config || !config.hasPopup) return null;

  return {
    route: config.popupRoute,
    eventName: config.popupEventName,
  };
}

// Helper function to check if method requires tab ID
export function methodRequiresTabId(method: string): boolean {
  const config = getMethodConfig(method);
  return config?.requiresTabId ?? true;
}

// Helper function to get all unrestricted methods
export function getUnrestrictedMethods(): string[] {
  return Object.entries(METHOD_REGISTRY)
    .filter(
      ([, config]) =>
        !config.requiresAuth &&
        !config.requiresConnection &&
        !config.hasPopup &&
        config.handlerType === MethodHandlerType.Eth
    )
    .map(([method]) => method);
}

// Helper function to get all restricted methods
export function getRestrictedMethods(): string[] {
  return Object.entries(METHOD_REGISTRY)
    .filter(
      ([, config]) =>
        (config.requiresAuth || config.requiresConnection) &&
        config.handlerType === MethodHandlerType.Eth
    )
    .map(([method]) => method);
}

// Helper function to validate method exists
export function isValidMethod(method: string): boolean {
  return !!METHOD_REGISTRY[method];
}

// Helper function to get cache configuration
export function getMethodCacheConfig(
  method: string
): { key?: string; ttl?: number } | null {
  const config = getMethodConfig(method);
  if (!config || !config.cacheKey) return null;

  return {
    key: config.cacheKey,
    ttl: config.cacheTTL,
  };
}
