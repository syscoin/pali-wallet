import { BigNumber } from '@ethersproject/bignumber';
import {
  CustomJsonRpcProvider,
  IKeyringAccountState,
} from '@sidhujag/sysweb3-keyring';
import { ISyscoinVIn, ISyscoinVOut } from '@sidhujag/sysweb3-utils';

import { IAccountTransactions } from 'state/vault/types';

//------------------------- EVM TYPES / INTERFACES -------------------------//
type AccessList = Array<{ address: string; storageKeys: Array<string> }>;

interface ILog {
  address: string;
  blockHash: string;
  blockNumber: number;

  data: string;

  logIndex: number;
  removed: boolean;

  topics: Array<string>;

  transactionHash: string;
  transactionIndex: number;
}

export interface IEvmTransaction {
  // EIP-2930; Type 1 & EIP-1559; Type 2
  accessList?: AccessList;
  chainId: number;
  confirmations?: number;
  data: string;
  from?: string;

  gasLimit: BigNumber;
  gasPrice?: BigNumber;

  hash?: string;
  // Transaction replacement tracking
  isReplaced?: boolean;
  isSpeedUp?: boolean;

  maxFeePerGas?: BigNumber;
  // EIP-1559; Type 2
  maxPriorityFeePerGas?: BigNumber;
  nonce: number;

  r?: string;

  replacesHash?: string;

  s?: string;
  status?: string;

  to?: string;
  // Typed-Transaction features
  type?: number | null;
  v?: number;
  value: BigNumber;
}

interface ITransactionReceipt {
  blockHash: string;
  blockNumber: number;
  byzantium: boolean;
  confirmations: number;
  contractAddress: string;
  cumulativeGasUsed: BigNumber;
  effectiveGasPrice: BigNumber;
  from: string;
  gasUsed: BigNumber;
  logs: Array<ILog>;
  logsBloom: string;
  root?: string;
  status?: number;
  to: string;
  transactionHash: string;
  transactionIndex: number;
  type: number;
}

export interface IEvmTransactionResponse extends IEvmTransaction {
  blockHash?: string;

  // Only if a transaction has been mined
  blockNumber?: number;
  confirmations: number;
  // Not optional (as it is in Transaction)
  from: string;
  hash: string;
  input?: string;

  isCanceled?: boolean;

  // The raw transaction
  raw?: string;

  timestamp?: number;

  // This function waits until the transaction has been mined
  wait: (confirmations?: number) => Promise<ITransactionReceipt>;
}

export type TransactionValueType =
  | string
  | number
  | { _hex: string; isBigNumber: boolean }
  | { hex: string; type: string };

export interface IEvmTransactionsController {
  fetchTransactionDetailsFromAPI: (
    hash: string,
    apiUrl: string
  ) => Promise<any>;
  fetchTransactionsFromAPI: (
    address: string,
    chainId: number,
    apiUrl?: string,
    includePending?: boolean
  ) => Promise<{
    error?: string;
    hasMore?: boolean;
    transactions: IEvmTransactionResponse[] | null;
  }>;
  fetchTransactionsPageFromAPI: (
    address: string,
    chainId: number,
    apiUrl: string,
    page: number,
    offset?: number
  ) => Promise<{
    error?: string;
    hasMore?: boolean;
    transactions: IEvmTransactionResponse[] | null;
  }>;
  getUserTransactionByDefaultProvider: (
    numBlocks: number,
    web3Provider: CustomJsonRpcProvider
  ) => Promise<IEvmTransactionResponse[]>;
  pollingEvmTransactions: (
    web3Provider: CustomJsonRpcProvider,
    isPolling?: boolean,
    isRapidPolling?: boolean
  ) => Promise<IEvmTransactionResponse[]>;
  testExplorerApi: (
    apiUrl: string
  ) => Promise<{ error?: string; success: boolean }>;
}

//------------------------- END EVM TYPES / INTERFACES -------------------------//

//------------------------- SYS TYPES / INTERFACES -------------------------//

export interface ISysTransaction {
  blockHash: string;
  blockHeight: number;
  blockTime: number;
  confirmations: number;
  // Array of token transfer details
  direction?: 'sent' | 'received';
  fees: string;
  hex: string;
  // SPT transaction type (e.g., 'assetallocation_send', 'syscoin_burn_to_allocation')
  tokenTransfers?: any[];
  tokenType?: string;
  txid: string;
  value: string;
  valueIn: string;
  version: number;
  vin: Array<
    ISyscoinVIn & {
      assetInfo?: {
        assetGuid: string;
        value?: number | string;
        valueStr?: string;
      };
      isOwn?: boolean;
    }
  >;
  vout: Array<
    ISyscoinVOut & {
      assetInfo?: {
        assetGuid: string;
        value?: number | string;
        valueStr?: string;
      };
      isOwn?: boolean;
    }
  >; // Transaction outputs
}

export interface ISysTransactionsController {
  fetchTransactionsPageFromBlockbook: (
    xpub: string,
    networkUrl: string,
    page: number,
    pageSize?: number
  ) => Promise<ISysTransaction[]>;
  getInitialUserTransactionsByXpub: (
    xpub: string,
    networkUrl: string
  ) => Promise<ISysTransaction[]>;
  pollingSysTransactions: (
    xpub: string,
    networkUrl: string
  ) => Promise<ISysTransaction[]>;
}

//------------------------- END SYS TYPES / INTERFACES -------------------------//

//------------------------- MANAGER TYPES / INTERFACES -------------------------//

export interface ITransactionsManagerUtils {
  clearCache: () => void;
  updateTransactionsFromCurrentAccount: (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    activeNetworkUrl: string,
    web3Provider: CustomJsonRpcProvider,
    accountTransactions?: IAccountTransactions,
    isPolling?: boolean,
    isRapidPolling?: boolean
  ) => Promise<IEvmTransaction[] | ISysTransaction[]>;
}
export interface ITransactionsManager {
  sys: ISysTransactionsController;
  utils: ITransactionsManagerUtils;
}

//------------------------- END MANAGER TYPES / INTERFACES -------------------------//
