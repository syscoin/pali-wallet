import { KeyringAccountType } from '@sidhujag/sysweb3-keyring';
import { AnyAction, Store } from 'redux';

import { IDAppState } from 'state/dapp/types';
import { loadState } from 'state/paliStorage';
import { IPriceState } from 'state/price/types';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import { setAccountTypeInAccountsObject, setActiveNetwork } from 'state/vault';
import { selectActiveAccount } from 'state/vault/selectors';
import { IVaultState, IGlobalState, TransactionsType } from 'state/vault/types';
import {
  setAdvancedSettings,
  setNetwork,
  setNetworks,
} from 'state/vaultGlobal';
import { IDAppController } from 'types/controllers';
import { INetwork } from 'types/network';
import {
  SYSCOIN_UTXO_MAINNET_NETWORK,
  CHAIN_IDS,
  PALI_NETWORKS_STATE,
} from 'utils/constants';

import DAppController from './DAppController';
import MainController from './MainController';

export interface IMasterController {
  appRoute: (newRoute?: string, external?: boolean) => string;
  callGetLatestUpdateForAccount: (isPolling?: boolean) => Promise<boolean>;
  createPopup: (
    route?: string,
    data?: object
  ) => Promise<chrome.windows.Window>;
  dapp: Readonly<IDAppController>;
  getInitializationStatus?: () => {
    attempts: number;
    isReady: boolean;
    maxAttempts: number;
  };
  refresh: () => void;
  rehydrate: () => void;
  retryInitialization?: () => Promise<{ retrying: boolean }>;
  wallet: MainController;
}

const MasterController = (
  externalStore: Store<
    {
      dapp: IDAppState;
      price: IPriceState;
      vault: IVaultState;
      vaultGlobal: IGlobalState;
    },
    AnyAction
  >
): IMasterController => {
  let route = '/';
  let externalRoute = '/';
  let wallet: MainController;
  let dapp: Readonly<IDAppController>;

  const initializeMainController = () => {
    const vaultGlobalState = externalStore.getState().vaultGlobal;

    // Initialize networks in vaultGlobal if they don't exist
    if (!vaultGlobalState.networks) {
      console.log('[MasterController] Initializing networks in vaultGlobal');
      // Initialize with all default networks at once
      externalStore.dispatch(setNetworks(PALI_NETWORKS_STATE));
    }

    // NFTs are now part of ethereum assets array, no separate initialization needed

    // Now safely check for specific networks
    const globalNetworks = externalStore.getState().vaultGlobal.networks;

    const currentRpcSysUtxoMainnet =
      globalNetworks &&
      globalNetworks[TransactionsType.Syscoin] &&
      globalNetworks[TransactionsType.Syscoin][CHAIN_IDS.SYSCOIN_MAINNET];

    const { activeNetwork } = externalStore.getState().vault;

    if (
      currentRpcSysUtxoMainnet &&
      currentRpcSysUtxoMainnet.url !== SYSCOIN_UTXO_MAINNET_NETWORK.url
    ) {
      // Update only this specific network, not all networks
      externalStore.dispatch(
        setNetwork({
          network: SYSCOIN_UTXO_MAINNET_NETWORK,
          isEdit: true, // Mark as edit to preserve other properties
        })
      );
    }

    const DEPRECATED_RPC_PATTERN = 'blockbook.elint.services';
    const isSysUtxoMainnetWithDeprecatedRpc =
      activeNetwork?.chainId === CHAIN_IDS.SYSCOIN_MAINNET &&
      activeNetwork?.url?.includes(DEPRECATED_RPC_PATTERN);

    if (isSysUtxoMainnetWithDeprecatedRpc) {
      externalStore.dispatch(setActiveNetwork(SYSCOIN_UTXO_MAINNET_NETWORK));
    }

    // Migration: Add any missing default networks from PALI_NETWORKS_STATE
    // This only adds networks that don't exist, doesn't overwrite existing ones
    Object.entries(PALI_NETWORKS_STATE.ethereum).forEach(
      ([chainId, network]) => {
        const chainIdNum = Number(chainId);
        if (
          network.default === true &&
          (!globalNetworks ||
            !globalNetworks[TransactionsType.Ethereum] ||
            !globalNetworks[TransactionsType.Ethereum][chainIdNum])
        ) {
          // Network is missing, add it
          externalStore.dispatch(
            setNetwork({
              network: network as INetwork,
            })
          );
        }
      }
    );

    if (externalStore.getState().vault?.accounts?.Ledger === undefined) {
      externalStore.dispatch(
        setAccountTypeInAccountsObject(KeyringAccountType.Ledger)
      );
    }
    if (externalStore.getState().vaultGlobal?.advancedSettings === undefined) {
      externalStore.dispatch(
        setAdvancedSettings({
          advancedProperty: 'refresh',
          value: false,
          isFirstTime: true,
        })
      );
      externalStore.dispatch(
        setAdvancedSettings({
          advancedProperty: 'ledger',
          value: false,
          isFirstTime: true,
        })
      );
    }

    dapp = Object.freeze(DAppController());
    wallet = new MainController();

    // Initialize startup state if wallet is already unlocked
    wallet.initializeStartupState();
  };

  const callGetLatestUpdateForAccount = async (isPolling?: boolean) =>
    wallet.getLatestUpdateForCurrentAccount(isPolling);

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
            state: 'normal',
          },
          (newWindow) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              // Flag is already set by atomicCheckAndSetPopup - just listen for close
              const handleWindowClose = (windowId: number) => {
                if (windowId === newWindow!.id) {
                  chrome.storage.local.remove(
                    ['pali-popup-open', 'pali-popup-timestamp'],
                    () => {
                      if (chrome.runtime.lastError) {
                        console.error(
                          '[index] Failed to remove popup flags on window close:',
                          chrome.runtime.lastError
                        );
                      }
                    }
                  );
                  chrome.windows.onRemoved.removeListener(handleWindowClose);
                }
              };

              chrome.windows.onRemoved.addListener(handleWindowClose);
              resolve(newWindow!);
            }
          }
        );
      });
    });

  const rehydrate = async () => {
    const storageState = await loadState();
    const activeSlip44 = storageState?.vaultGlobal?.activeSlip44;

    console.log(`[MasterController] Rehydrating with slip44: ${activeSlip44}`);
    await rehydrateStore(store, undefined, activeSlip44);
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
    // These will be overridden in the background script if initialization fails
    getInitializationStatus: () => ({
      isReady: true,
      attempts: 0,
      maxAttempts: 3,
    }),
    retryInitialization: async () => ({ retrying: false }),
  };
};

export default MasterController;
