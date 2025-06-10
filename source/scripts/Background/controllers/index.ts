import omit from 'lodash/omit';
import { AnyAction, Store } from 'redux';

import {
  accountType,
  IKeyringAccountState,
  IWalletState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetworkType } from '@pollum-io/sysweb3-network';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import { IDAppState } from 'state/dapp/types';
import { IPriceState } from 'state/price/types';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import {
  setAccountPropertyByIdAndType,
  setAccountTypeInAccountsObject,
  setActiveNetwork,
  setAdvancedSettings,
  setIsLastTxConfirmed,
  setNetwork,
} from 'state/vault';
import { IPaliAccount, IVaultState, TransactionsType } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import {
  ROLLUX_DEFAULT_NETWORK,
  SYSCOIN_MAINNET_DEFAULT_NETWORK,
  CHAIN_IDS,
  PALI_NETWORKS_STATE,
} from 'utils/constants';
import { getNetworkChain } from 'utils/network';

import DAppController from './DAppController';
import MainController from './MainController';

export interface IMasterController {
  appRoute: (newRoute?: string, external?: boolean) => string;
  callGetLatestUpdateForAccount: () => Promise<boolean>;
  createPopup: (
    route?: string,
    data?: object
  ) => Promise<chrome.windows.Window>;
  dapp: Readonly<IDAppController>;
  refresh: () => void;
  rehydrate: () => void;
  wallet: MainController;
}

export const vaultToWalletState = (vaultState: IVaultState) => {
  const accounts: { [key in KeyringAccountType]: accountType } = Object.entries(
    vaultState.accounts
  ).reduce((acc, [sysAccountType, paliAccountType]) => {
    acc[sysAccountType as KeyringAccountType] = Object.fromEntries(
      Object.entries(paliAccountType).map(([accountId, paliAccount]) => {
        const keyringAccountState: IKeyringAccountState = omit(paliAccount, [
          'assets',
          'transactions',
        ]) as IKeyringAccountState;
        return [accountId, keyringAccountState];
      })
    );
    return acc;
  }, {} as { [key in KeyringAccountType]: accountType });

  const sysweb3Wallet: IWalletState = {
    accounts,
    activeAccountId: vaultState.activeAccount.id,
    activeAccountType: vaultState.activeAccount.type,
    networks: vaultState.networks,
    activeNetwork: vaultState.activeNetwork,
  };
  const activeChain: INetworkType = vaultState.activeChain;

  return { wallet: sysweb3Wallet, activeChain };
};

const MasterController = (
  externalStore: Store<
    {
      dapp: IDAppState;
      price: IPriceState;
      vault: IVaultState;
    },
    AnyAction
  >
): IMasterController => {
  let route = '/';
  let externalRoute = '/';
  let wallet: MainController;
  let dapp: Readonly<IDAppController>;

  const getAccountType = (account: IPaliAccount): KeyringAccountType =>
    !account.isImported && !account.isTrezorWallet
      ? KeyringAccountType.HDAccount
      : account.isTrezorWallet
      ? KeyringAccountType.Trezor
      : account.isLedgerWallet
      ? KeyringAccountType.Ledger
      : KeyringAccountType.Imported;

  const initializeMainController = () => {
    const hdAccounts = Object.values(
      externalStore.getState().vault.accounts.HDAccount
    );
    const trezorAccounts = Object.values(
      externalStore.getState().vault.accounts.Trezor
    );
    const importedAccounts = Object.values(
      externalStore.getState().vault.accounts.Imported
    );

    const accountsObj = [...hdAccounts, ...trezorAccounts, ...importedAccounts];

    const validateIfNftsStateExists = accountsObj.some((account) =>
      account.assets.hasOwnProperty('nfts')
    );

    if (!validateIfNftsStateExists) {
      accountsObj.forEach((account) => {
        const accType = getAccountType(account);

        const updatedAssets = {
          ...account.assets,
          nfts: [] as INftsStructure[],
        };

        externalStore.dispatch(
          setAccountPropertyByIdAndType({
            id: account.id,
            type: accType,
            property: 'assets',
            value: updatedAssets,
          })
        );
      });
    }

    if (
      !externalStore.getState().vault.networks[TransactionsType.Ethereum][
        CHAIN_IDS.ROLLUX_MAINNET
      ]
    ) {
      externalStore.dispatch(setNetwork(ROLLUX_DEFAULT_NETWORK));
    }

    const currentRpcSysUtxoMainnet =
      externalStore.getState().vault.networks[TransactionsType.Syscoin][
        CHAIN_IDS.SYSCOIN_MAINNET
      ];

    const { activeNetwork } = externalStore.getState().vault;

    if (
      currentRpcSysUtxoMainnet &&
      currentRpcSysUtxoMainnet.url !==
        SYSCOIN_MAINNET_DEFAULT_NETWORK.network.url
    ) {
      externalStore.dispatch(setNetwork(SYSCOIN_MAINNET_DEFAULT_NETWORK));
    }

    const DEPRECATED_RPC_PATTERN = 'blockbook.elint.services';
    const isSysUtxoMainnetWithDeprecatedRpc =
      activeNetwork.chainId === CHAIN_IDS.SYSCOIN_MAINNET &&
      activeNetwork.url.includes(DEPRECATED_RPC_PATTERN);

    if (isSysUtxoMainnetWithDeprecatedRpc) {
      externalStore.dispatch(
        setActiveNetwork(SYSCOIN_MAINNET_DEFAULT_NETWORK.network)
      );
    }

    const isNetworkOldState =
      externalStore.getState()?.vault?.networks?.[TransactionsType.Ethereum][
        CHAIN_IDS.ETHEREUM_MAINNET
      ]?.default ?? false;

    const isNetworkOldEVMStateWithoutTestnet =
      externalStore.getState()?.vault?.networks?.[TransactionsType.Ethereum][
        CHAIN_IDS.ETHEREUM_MAINNET
      ]?.isTestnet === undefined;

    const isNetworkOldUTXOStateWithoutTestnet =
      externalStore.getState()?.vault?.networks?.[TransactionsType.Syscoin][
        CHAIN_IDS.SYSCOIN_MAINNET
      ]?.isTestnet === undefined;

    if (isNetworkOldState || isNetworkOldEVMStateWithoutTestnet) {
      Object.values(PALI_NETWORKS_STATE.ethereum).forEach((network) => {
        externalStore.dispatch(
          setNetwork({
            chain: INetworkType.Ethereum,
            network: network,
            isFirstTime: true,
          })
        );
      });
    }

    if (isNetworkOldUTXOStateWithoutTestnet) {
      Object.values(PALI_NETWORKS_STATE.syscoin).forEach((network) => {
        externalStore.dispatch(
          setNetwork({
            chain: INetworkType.Syscoin,
            network: network,
            isFirstTime: true,
          })
        );
      });
    }

    if (externalStore.getState().vault?.accounts?.Ledger === undefined) {
      externalStore.dispatch(
        setAccountTypeInAccountsObject(KeyringAccountType.Ledger)
      );
    }
    if (externalStore.getState().vault?.advancedSettings === undefined) {
      externalStore.dispatch(
        setAdvancedSettings({
          advancedProperty: 'refresh',
          isActive: false,
          isFirstTime: true,
        })
      );
      externalStore.dispatch(
        setAdvancedSettings({
          advancedProperty: 'ledger',
          isActive: false,
          isFirstTime: true,
        })
      );
    }

    if (externalStore.getState().vault?.isLastTxConfirmed === undefined) {
      externalStore.dispatch(
        setIsLastTxConfirmed({
          chainId: 0,
          wasConfirmed: false,
          isFirstTime: true,
        })
      );
    }

    const isBitcoinBased = externalStore.getState()?.vault?.isBitcoinBased;

    const isTransactionsOldState = accountsObj.some((account) =>
      Array.isArray(account.transactions)
    );

    if (isTransactionsOldState) {
      const {
        activeNetwork: { chainId },
      } = externalStore.getState().vault;

      accountsObj.forEach((account) => {
        const accType = getAccountType(account);

        if (Array.isArray(account.transactions)) {
          if (account.transactions.length > 0) {
            const updatedTransactions = {
              [INetworkType.Syscoin]: {},
              [INetworkType.Ethereum]: {},
            } as { [chainType: string]: { [chainId: string]: any } };

            account.transactions.forEach((tx) => {
              const currentNetwork = getNetworkChain(isBitcoinBased);
              const currentChainId = isBitcoinBased ? chainId : tx.chainId;

              updatedTransactions[currentNetwork][currentChainId] = [
                ...(updatedTransactions[currentNetwork]?.[currentChainId] ??
                  []),
                tx,
              ];
            });

            externalStore.dispatch(
              setAccountPropertyByIdAndType({
                id: account.id,
                type: accType,
                property: 'transactions',
                value: updatedTransactions,
              })
            );
          } else {
            externalStore.dispatch(
              setAccountPropertyByIdAndType({
                id: account.id,
                type: accType,
                property: 'transactions',
                value: {
                  [INetworkType.Syscoin]: {},
                  [INetworkType.Ethereum]: {},
                },
              })
            );
          }
        }
      });
    }
    const walletState = vaultToWalletState(externalStore.getState().vault);
    dapp = Object.freeze(DAppController());
    wallet = new MainController(walletState);
    wallet.setStorage(chrome.storage.local);

    // Initialize startup state if wallet is already unlocked
    wallet.initializeStartupState();
  };

  const callGetLatestUpdateForAccount = () =>
    wallet.getLatestUpdateForCurrentAccount();

  const refresh = () => {
    const { activeAccount, accounts } = externalStore.getState().vault;
    if (!accounts[activeAccount.type][activeAccount.id].address) return;
    callGetLatestUpdateForAccount();
  };

  /**
   * Determine which is the app route
   * @returns the proper route
   */
  const appRoute = (newRoute?: string, external = false) => {
    if (newRoute) {
      if (external) externalRoute = newRoute;
      else route = newRoute;
    }
    return external ? externalRoute : route;
  };

  /**
   * Creates a popup for external routes. Mostly for DApps
   * @returns the window object from the popup
   */
  const createPopup = async (
    popUpRoute = '',
    data = {}
  ): Promise<chrome.windows.Window> =>
    new Promise((resolve, reject) => {
      chrome.windows.getCurrent((window) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        if (!window || !window.width) {
          reject(new Error('No window available'));
          return;
        }

        const params = new URLSearchParams();
        if (popUpRoute) params.append('route', popUpRoute);
        if (data) params.append('data', JSON.stringify(data));

        chrome.windows.create(
          {
            url: '/external.html?' + params.toString(),
            width: 400,
            height: 620,
            type: 'popup',
          },
          (newWindow) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(newWindow!);
            }
          }
        );
      });
    });

  const rehydrate = async () => {
    await rehydrateStore(store);
  };

  initializeMainController();

  return {
    rehydrate,
    appRoute,
    createPopup,
    dapp,
    refresh,
    callGetLatestUpdateForAccount,
    wallet,
  };
};

export default MasterController;
