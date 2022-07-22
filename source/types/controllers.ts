import {
  IKeyringAccountState,
  INetwork,
  KeyringManager,
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import { ISigRequest } from 'scripts/Background/controllers/DAppController';
import { IDApp } from 'state/dapp/types';

export interface IMainController extends KeyringManager {
  account: any;
  addCustomRpc: (network: INetwork) => Promise<INetwork | Error>;
  createAccount: (label?: string) => Promise<IKeyringAccountState>;
  createWallet: () => Promise<IKeyringAccountState>;
  forgetWallet: (pwd: string) => void;
  lock: () => void;
  setAccount: (id: number) => void;
  setActiveNetwork: (
    chain: string,
    chainId: number
  ) => Promise<IKeyringAccountState>;
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
  appRoute: (newRoute?: string, external?: boolean) => string;
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

export interface IDAppController {
  addDApp: (origin: string, title: string) => void;
  addListener: (origin: string, eventName: string) => void;
  changeAccount: (origin: string, accountId: number) => void;
  connect: (origin: string, accountId: number) => void;
  disconnect: (origin: string) => void;
  getAccount: (origin: string) => IKeyringAccountState | undefined;
  getDApp: (origin: string) => IDApp | undefined;
  getSigRequest: () => ISigRequest;
  hasDApp: (origin: string) => boolean;
  hasListener: (origin: string, eventName: string) => boolean;
  isConnected: (origin: string) => boolean;
  removeListener: (origin: string, eventName: string) => void;
  removeListeners: (origin: string) => void;
  // setCurrent: (origin: string, title: string) => boolean;
  setSigRequest: (req: ISigRequest) => void;
}
