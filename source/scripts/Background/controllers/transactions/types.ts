import { ethers } from 'ethers';

// EVM TYPES / INTERFACES
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

export interface ITransactionResponse extends IEvmTransaction {
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
  firstRunForProviderTransactions: () => Promise<void>;
  getUserTransactionByDefaultProvider: (
    startBlock: number,
    endBlock: number
  ) => Promise<void>;
  pollingEvmTransactions: (
    provider:
      | ethers.providers.EtherscanProvider
      | ethers.providers.JsonRpcProvider
  ) => Promise<void>;
}
