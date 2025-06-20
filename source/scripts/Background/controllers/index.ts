import { AnyAction, Store } from 'redux';

import { IWalletState, KeyringAccountType } from '@pollum-io/sysweb3-keyring';
import { INetworkType } from '@pollum-io/sysweb3-network';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import { IDAppState } from 'state/dapp/types';
import { IPriceState } from 'state/price/types';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import {
  setAccountTypeInAccountsObject,
  setActiveNetwork,
  setAdvancedSettings,
  setIsLastTxConfirmed,
  setNetwork,
  setAccountAssets,
} from 'state/vault';
import { selectActiveAccount } from 'state/vault/selectors';
import { IVaultState, TransactionsType } from 'state/vault/types';
import { IDAppController } from 'types/controllers';
import {
  ROLLUX_DEFAULT_NETWORK,
  SYSCOIN_MAINNET_DEFAULT_NETWORK,
  CHAIN_IDS,
  PALI_NETWORKS_STATE,
} from 'utils/constants';

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
  // With the new architecture, accounts are already clean IKeyringAccountState objects
  // stored in the correct structure - no transformation needed
  const accounts = vaultState.accounts;

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

  const initializeMainController = () => {
    const vaultState = externalStore.getState().vault;

    // Check if NFTs structure exists in accountAssets
    const needsNftsInit = Object.entries(vaultState.accountAssets).some(
      ([, accounts]) =>
        Object.entries(accounts).some(([, assets]) => !assets.nfts)
    );

    if (needsNftsInit) {
      // Initialize NFTs array for any accounts missing it
      Object.entries(vaultState.accountAssets).forEach(([, accounts]) => {
        Object.entries(accounts).forEach(([accountId, assets]) => {
          if (!assets.nfts) {
            externalStore.dispatch(
              setAccountAssets({
                accountId: Number(accountId),
                accountType: KeyringAccountType.HDAccount,
                property: 'nfts',
                value: [] as INftsStructure[],
              })
            );
          }
        });
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

    if (isNetworkOldState) {
      Object.values(PALI_NETWORKS_STATE.ethereum).forEach((network) => {
        externalStore.dispatch(
          setNetwork({
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

    // Note: Removed old transaction migration logic since the new architecture
    // handles this differently with separated accountTransactions structure

    const walletState = vaultToWalletState(externalStore.getState().vault);
    dapp = Object.freeze(DAppController());
    wallet = new MainController(walletState);

    // Initialize startup state if wallet is already unlocked
    wallet.initializeStartupState();
  };

  const callGetLatestUpdateForAccount = () =>
    wallet.getLatestUpdateForCurrentAccount();

  const refresh = () => {
    const vaultState = externalStore.getState().vault;
    const activeAccount = selectActiveAccount({ vault: vaultState } as any);
    if (!activeAccount?.address) return;
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
