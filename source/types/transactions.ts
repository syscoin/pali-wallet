import { BigNumber } from '@ethersproject/bignumber';

export interface ITransaction {
  blockTime: number;
  confirmations: number;
  fees: number;
  tokenType: string;
  txid: string;
  value: number;
}

export interface IAssets {
  assetGuid: number;
  balance: number;
  decimals: number;
  symbol: string;
  type: string;
}

export interface IAccountInfo {
  address?: string | null;
  assets: IAssets[];
  balance: number;
  transactions: ITransaction[];
}

export interface IPendingTx {
  blockTime: number;
  confirmations: number;
  fees: number;
  txid: string;
  value: number;
}

export interface ICustomRpcParams {
  apiUrl?: string;
  chainId: number;
  explorer?: string;
  isSyscoinRpc?: boolean;
  label: string;
  symbol?: string;
  url: string;
}

export interface ITxState {
  chainId: number;
  data: string;
  from: string;
  gasLimit: BigNumber | string | number | undefined;
  maxFeePerGas: BigNumber | string | number | undefined;
  maxPriorityFeePerGas: BigNumber | string | number | undefined;
  nonce?: number;
  to: string;
  token?: any;
  value: number;
}

export interface IFeeState {
  baseFee: number;
  gasLimit: number;
  gasPrice?: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
}

export interface ITransactionParams {
  data: string;
  from: string;
  gas?: string;
  gasLimit?: string | number;
  maxFeePerGas?: string | number;
  maxPriorityFeePerGas?: string | number;
  to: string;
  type?: string;
  value?: number;
}
export interface IDecodedTx {
  inputs: any[];
  method: string | null;
  names: string[];
  types: string[];
}

export interface ICustomApprovedAllowanceAmount {
  customAllowanceValue?: number | null;
  defaultAllowanceValue?: number;
  isCustom: boolean;
}

export interface IApprovedTokenInfos {
  tokenDecimals: number;
  tokenSymbol: string;
}

export interface ICustomFeeParams {
  gasLimit: number;
  gasPrice?: number;
  isCustom: boolean;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
}

export interface IIsEditedAllowanceModalProps {
  approvedTokenInfos: IApprovedTokenInfos;
  customApprovedAllowanceAmount: ICustomApprovedAllowanceAmount;
  host: string;
  setCustomApprovedAllowanceAmount: React.Dispatch<
    React.SetStateAction<ICustomApprovedAllowanceAmount>
  >;
  setOpenEditFeeModal: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

// eslint-disable-next-line no-shadow
export enum TransactionType {
  ERC1155 = 'ERC1155',
  ERC20 = 'ERC20',
  ERC721 = 'ERC721',
  NATIVE_ETH = 'NATIVE_ETH',
  UTXO = 'UTXO',
}

export interface ITransactionTypeInfo {
  defaultGasLimit?: number;
  isLegacy?: boolean;
  type: TransactionType;
}
