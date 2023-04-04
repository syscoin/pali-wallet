import { ethers } from 'ethers';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';
import { ISyscoinVIn, ISyscoinVOut } from '@pollum-io/sysweb3-utils';

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
  data: string;
  from?: string;

  gasLimit: ethers.BigNumber;
  gasPrice?: ethers.BigNumber;

  hash?: string;
  maxFeePerGas?: ethers.BigNumber;
  // EIP-1559; Type 2
  maxPriorityFeePerGas?: ethers.BigNumber;

  nonce: number;
  r?: string;
  s?: string;

  to?: string;

  // Typed-Transaction features
  type?: number | null;

  v?: number;
  value: ethers.BigNumber;
}

interface ITransactionReceipt {
  blockHash: string;
  blockNumber: number;
  byzantium: boolean;
  confirmations: number;
  contractAddress: string;
  cumulativeGasUsed: ethers.BigNumber;
  effectiveGasPrice: ethers.BigNumber;
  from: string;
  gasUsed: ethers.BigNumber;
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

  // The raw transaction
  raw?: string;

  timestamp?: number;

  // This function waits until the transaction has been mined
  wait: (confirmations?: number) => Promise<ITransactionReceipt>;
}

export interface IEvmTransactionsController {
  firstRunForProviderTransactions: (
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => Promise<IEvmTransactionResponse[]>;
  getUserTransactionByDefaultProvider: (
    currentAccount: IKeyringAccountState,
    networkUrl: string,
    startBlock: number,
    endBlock: number
  ) => Promise<IEvmTransactionResponse[]>;
  pollingEvmTransactions: (
    currentAccount: IKeyringAccountState,
    networkUrl: string
  ) => Promise<IEvmTransactionResponse[]>;
}

//------------------------- END EVM TYPES / INTERFACES -------------------------//

//------------------------- SYS TYPES / INTERFACES -------------------------//

export interface ISysTransaction {
  blockHash: string;
  blockHeight: number;
  blockTime: number;
  confirmations: number;
  fees: string;
  hex: string;
  txid: string;
  value: string;
  valueIn: string;
  version: number;
  vin: ISyscoinVIn[];
  vout: ISyscoinVOut;
}

export interface ISysTransactionsController {
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
  updateTransactionsFromCurrentAccount: (
    currentAccount: IKeyringAccountState,
    isBitcoinBased: boolean,
    activeNetworkUrl: string
  ) => Promise<ISysTransaction[] | IEvmTransaction[]>;
}
export interface ITransactionsManager {
  evm: IEvmTransactionsController;
  sys: ISysTransactionsController;
  utils: ITransactionsManagerUtils;
}

//------------------------- END MANAGER TYPES / INTERFACES -------------------------//
