import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

export interface IVaultState {
  accounts: { [key in KeyringAccountType]: PaliAccountType }; //todo adjust and guarantee type is correct
  activeAccountId: number;
  activeAccountType: KeyringAccountType;
  activeChain: INetworkType;
  activeNetwork: INetwork;
  changingConnectedAccount: IChangingConnectedAccount;
  encryptedMnemonic: string;
  error: boolean;
  isBitcoinBased: boolean;
  isLoadingTxs: boolean;
  isNetworkChanging: boolean;
  isPendingBalances: boolean;
  isTimerEnabled: boolean;
  lastLogin: number;
  networks: {
    [INetworkType.Ethereum]: {
      [chainId: number]: INetwork;
    };
    [INetworkType.Syscoin]: {
      [chainId: number]: INetwork;
    };
  };
  timer: number;
}

export interface IChangingConnectedAccount {
  host: string | undefined;
  isChangingConnectedAccount: boolean;
  newConnectedAccount: IKeyringAccountState | undefined;
}

export interface IPaliAccountType extends IKeyringAccountState {
  assets: {
    ethereum: [];
    syscoin: [];
  };
  transactions: [];
}
export type PaliAccountType = {
  [id: number]: IPaliAccountType;
};

export type IOmmitedAccount = Omit<IKeyringAccountState, 'xprv'>;

export type IOmittedVault = Omit<IVaultState, 'accounts'> & {
  accounts: { [id: number]: IOmmitedAccount };
};
