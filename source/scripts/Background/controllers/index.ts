import omit from 'lodash/omit';
import { browser, Windows } from 'webextension-polyfill-ts';

import {
  accountType,
  IKeyringAccountState,
  initialNetworksState,
  IWalletState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import { persistor, RootState } from 'state/store';
import store from 'state/store';
import { IPersistState } from 'state/types';
import {
  setAccountPropertyByIdAndType,
  setAccountTypeInAccountsObject,
  setActiveNetwork,
  setAdvancedSettings,
  setFaucetModalState,
  setIsLastTxConfirmed,
  setNetwork,
  setTimer,
} from 'state/vault';
import { IPaliAccount, IVaultState, TransactionsType } from 'state/vault/types';
import {
  IControllerUtils,
  IDAppController,
  IMainController,
} from 'types/controllers';
import {
  ROLLUX_DEFAULT_NETWORK,
  SYSCOIN_MAINNET_DEFAULT_NETWORK,
  SYSCOIN_MAINNET_NETWORK_57,
} from 'utils/constants';
import { getNetworkChain } from 'utils/network';

import ControllerUtils from './ControllerUtils';
import DAppController from './DAppController';
import MainController from './MainController';

export interface IMasterController {
  appRoute: (newRoute?: string, external?: boolean) => string;
  callGetLatestUpdateForAccount: () => void;
  createPopup: (route?: string, data?: object) => Promise<Windows.Window>;
  dapp: Readonly<IDAppController>;
  refresh: () => void;
  utils: Readonly<IControllerUtils>;
  wallet: IMainController;
}

const getAccountType = (account: IPaliAccount): KeyringAccountType =>
  !account.isImported && !account.isTrezorWallet
    ? KeyringAccountType.HDAccount
    : account.isTrezorWallet
    ? KeyringAccountType.Trezor
    : account.isLedgerWallet
    ? KeyringAccountType.Ledger
    : KeyringAccountType.Imported;

const MasterController = (
  readyCallback: (windowController: any) => void
): IMasterController => {
  let route = '/';
  let externalRoute = '/';
  let wallet: IMainController;
  let utils: Readonly<IControllerUtils>;
  let dapp: Readonly<IDAppController>;
  const vaultToWalletState = (vaultState: IVaultState) => {
    const accounts: { [key in KeyringAccountType]: accountType } =
      Object.entries(vaultState.accounts).reduce(
        (acc, [sysAccountType, paliAccountType]) => {
          acc[sysAccountType as KeyringAccountType] = Object.fromEntries(
            Object.entries(paliAccountType).map(([accountId, paliAccount]) => {
              const keyringAccountState: IKeyringAccountState = omit(
                paliAccount,
                ['assets', 'transactions']
              ) as IKeyringAccountState;
              return [accountId, keyringAccountState];
            })
          );
          return acc;
        },
        {} as { [key in KeyringAccountType]: accountType }
      );

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
  // Subscribe to store updates
  persistor.subscribe(() => {
    const state = store.getState() as RootState & { _persist: IPersistState };
    const {
      _persist: { rehydrated },
    } = state;
    if (rehydrated) {
      initializeMainController();
    }
  });
  const initializeMainController = () => {
    const hdAccounts = Object.values(store.getState().vault.accounts.HDAccount);
    const trezorAccounts = Object.values(
      store.getState().vault.accounts.Trezor
    );
    const importedAccounts = Object.values(
      store.getState().vault.accounts.Imported
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

        store.dispatch(
          setAccountPropertyByIdAndType({
            id: account.id,
            type: accType,
            property: 'assets',
            value: updatedAssets,
          })
        );
      });
    }

    if (!store.getState().vault.networks[TransactionsType.Ethereum][570]) {
      store.dispatch(setNetwork(ROLLUX_DEFAULT_NETWORK));
    }

    const currentRpcSysUtxoMainnet =
      store.getState().vault.networks[TransactionsType.Syscoin][57].url;

    const { activeNetwork } = store.getState().vault;

    if (currentRpcSysUtxoMainnet !== 'https://blockbook.syscoin.org') {
      store.dispatch(setNetwork(SYSCOIN_MAINNET_DEFAULT_NETWORK));
    }

    const isSysUtxoMainnetWithWrongRpcUrl =
      activeNetwork.chainId === 57 &&
      activeNetwork.url.includes('https://blockbook.elint.services');

    if (isSysUtxoMainnetWithWrongRpcUrl) {
      store.dispatch(setActiveNetwork(SYSCOIN_MAINNET_NETWORK_57));
    }

    // if timer state is 5, it means that the user is coming from a previous version, with a default timer value of 5 minutes.
    if (Number(store.getState().vault.timer) === 5) {
      store.dispatch(setTimer(30));
    }

    const isNetworkOldState =
      store.getState()?.vault?.networks?.[TransactionsType.Ethereum][1]
        ?.default ?? false;

    const isNetworkOldEVMStateWithoutTestnet =
      store.getState()?.vault?.networks?.[TransactionsType.Ethereum][1]
        ?.isTestnet === undefined;

    const isNetworkOldUTXOStateWithoutTestnet =
      store.getState()?.vault?.networks?.[TransactionsType.Syscoin][57]
        ?.isTestnet === undefined;

    const isOldFaucetState = store.getState()?.vault?.faucetModal === undefined;

    if (isOldFaucetState) {
      store.dispatch(setFaucetModalState({ chainId: 0, isFirstTime: true }));
    }

    if (isNetworkOldState || isNetworkOldEVMStateWithoutTestnet) {
      Object.values(initialNetworksState[TransactionsType.Ethereum]).forEach(
        (network) => {
          store.dispatch(
            setNetwork({
              chain: INetworkType.Ethereum,
              network: network as INetwork,
            })
          );
        }
      );
    }

    if (isNetworkOldUTXOStateWithoutTestnet) {
      Object.values(initialNetworksState[TransactionsType.Syscoin]).forEach(
        (network) => {
          store.dispatch(
            setNetwork({
              chain: INetworkType.Syscoin,
              network: network as INetwork,
            })
          );
        }
      );
    }

    if (store.getState().vault?.accounts?.Ledger === undefined) {
      store.dispatch(setAccountTypeInAccountsObject(KeyringAccountType.Ledger));
    }
    if (store.getState().vault?.advancedSettings === undefined) {
      store.dispatch(
        setAdvancedSettings({
          advancedProperty: 'refresh',
          isActive: false,
          isFirstTime: true,
        })
      );
      store.dispatch(
        setAdvancedSettings({
          advancedProperty: 'ledger',
          isActive: false,
          isFirstTime: true,
        })
      );
    }

    if (store.getState().vault?.isLastTxConfirmed === undefined) {
      store.dispatch(
        setIsLastTxConfirmed({
          chainId: 0,
          wasConfirmed: false,
          isFirstTime: true,
        })
      );
    }

    const isBitcoinBased = store.getState()?.vault?.isBitcoinBased;

    const isTransactionsOldState = accountsObj.some((account) =>
      Array.isArray(account.transactions)
    );

    if (isTransactionsOldState) {
      const {
        activeNetwork: { chainId },
      } = store.getState().vault;

      accountsObj.forEach((account) => {
        const accType = getAccountType(account);

        if (Array.isArray(account.transactions)) {
          if (account.transactions.length > 0) {
            const updatedTransactions = {
              syscoin: {},
              ethereum: {},
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

            store.dispatch(
              setAccountPropertyByIdAndType({
                id: account.id,
                type: accType,
                property: 'transactions',
                value: updatedTransactions,
              })
            );
          } else {
            store.dispatch(
              setAccountPropertyByIdAndType({
                id: account.id,
                type: accType,
                property: 'transactions',
                value: {
                  syscoin: {},
                  ethereum: {},
                },
              })
            );
          }
        }
      });
    }
    const walletState = vaultToWalletState(store.getState().vault);
    dapp = Object.freeze(DAppController());
    wallet = Object.freeze(MainController(walletState));
    utils = Object.freeze(ControllerUtils());
    wallet.setStorage(window.localStorage);
    readyCallback({
      appRoute,
      createPopup,
      dapp,
      refresh,
      utils,
      wallet,
      callGetLatestUpdateForAccount,
    });
  };

  const callGetLatestUpdateForAccount = () =>
    wallet.getLatestUpdateForCurrentAccount();

  const refresh = () => {
    const { activeAccount, accounts } = store.getState().vault;
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
  const createPopup = async (popUpRoute = '', data = {}) => {
    const window = await browser.windows.getCurrent();

    if (!window || !window.width) return;

    const params = new URLSearchParams();
    if (popUpRoute) params.append('route', popUpRoute);
    if (data) params.append('data', JSON.stringify(data));

    return browser.windows.create({
      url: '/external.html?' + params.toString(),
      width: 400,
      height: 620,
      type: 'popup',
    });
  };

  return {
    appRoute,
    createPopup,
    dapp,
    refresh,
    callGetLatestUpdateForAccount,
    utils,
    wallet,
  };
};

export default MasterController;
