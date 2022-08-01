import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { IKeyringManager } from '@pollum-io/sysweb3-keyring';
import {
  IKeyringAccountState,
  INetwork,
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import { ISysAccountController } from 'scripts/Background/controllers/account/syscoin';

import { ICustomRpcParams } from './transactions';

// TODO IWeb3Accounts
const web3Accounts = Web3Accounts();
type IWeb3Accounts = typeof web3Accounts;

export interface IMainController extends IKeyringManager {
  account: {
    eth: IWeb3Accounts;
    sys: ISysAccountController;
  };
  addCustomRpc: (rpc: ICustomRpcParams) => Promise<INetwork>;
  createAccount: (label?: string) => Promise<IKeyringAccountState>;
  createWallet: () => Promise<IKeyringAccountState>;
  editCustomRpc: (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ) => Promise<INetwork>;
  forgetWallet: (pwd: string) => void;
  lock: () => void;
  removeKeyringNetwork: (chain: string, chainId: number) => void;
  setAccount: (id: number) => void;
  setActiveNetwork: (
    chain: string,
    chainId: number,
    key?: string | number
  ) => Promise<IKeyringAccountState>;
  setActiveTokenForWallet: () => Promise<void>;
  setAutolockTimer: (minutes: number) => void;
  unlock: (pwd: string) => Promise<void>;
}

export interface IEthTokenDetails {
  contract: string;
  decimals: number;
  description: string;
  id: string;
  name: string;
  symbol: string;
}

export interface IControllerUtils {
  appRoute: (newRoute?: string) => string;
  getAsset: (
    explorerUrl: string,
    assetGuid: string
  ) => Promise<{
    assetGuid: string;
    contract: string;
    decimals: number;
    maxSupply: string;
    pubData: any;
    symbol: string;
    totalSupply: string;
    updateCapabilityFlags: number;
  }>;
  // eslint-disable-next-line @typescript-eslint/ban-types
  getFeeRate: (fee: number) => BigInt;
  getGasUsedInTransaction: (transactionHash: string) => Promise<{
    effectiveGasPrice: number;
    gasUsed: number;
  }>;
  getPsbtFromJson: (psbt: JSON) => string;
  getRawTransaction: (explorerUrl: string, txid: string) => any;
  getSearch: (query: string) => Promise<ICoingeckoSearchResults>;
  getToken: (tokenId: string) => Promise<ICoingeckoToken>;
  getTokenByContract: (contractAddress: string) => Promise<ICoingeckoToken>;
  getTokenJson: () => {
    address: string;
    chainId: number;
    decimals: number;
    logoURI: string;
    name: string;
    symbol: string;
  }[];
  getTokenMap: ({
    guid,
    changeAddress,
    amount,
    receivingAddress,
  }: {
    amount: number;
    changeAddress: string;
    guid: number | string;
    receivingAddress: string;
  }) => ITokenMap;
  isValidEthereumAddress: (value: string, activeNetwork: INetwork) => boolean;
  isValidSYSAddress: (
    address: string,
    activeNetwork: INetwork,
    verification?: boolean
  ) => boolean;
  setFiat: (currency?: string, assetId?: string) => Promise<void>;
}
