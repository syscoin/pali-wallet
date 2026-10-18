import { useLayoutEffect } from 'react';

import { rehydrate as dappRehydrate } from 'state/dapp';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import {
  rehydrate as vaultRehydrate,
  setAccounts,
  setActiveAccount,
  setAccountBalanceSnapshot,
} from 'state/vault';
import {
  setActiveSlip44,
  setNetworkRuntimeState,
  setNetworkStatus,
} from 'state/vaultGlobal';

/** Keep background updates subscribed even while the guarded router is absent. */
export const useControllerStateSync = (enabled: boolean) => {
  useLayoutEffect(() => {
    if (!enabled) return;
    let active = true;
    let isRehydrating = false;
    let pendingState: any = null;

    const processState = (state: any) => {
      isRehydrating = true;
      rehydrateStore(store, state).finally(() => {
        if (!active) return;
        if (pendingState) {
          const nextState = pendingState;
          pendingState = null;
          processState(nextState);
        } else {
          isRehydrating = false;
        }
      });
    };

    function handleStateChange(message: any) {
      if (message.type === 'CONTROLLER_DAPP_STATE_CHANGE' && message.data) {
        store.dispatch(dappRehydrate(message.data));
        return true;
      }

      if (message.type === 'CONTROLLER_ACCOUNTS_CHANGE' && message.data) {
        store.dispatch(setAccounts(message.data));
        return true;
      }

      if (message.type === 'CONTROLLER_NETWORK_STATUS_CHANGE' && message.data) {
        if (typeof message.data === 'string') {
          store.dispatch(setNetworkStatus(message.data));
        } else {
          store.dispatch(setNetworkRuntimeState(message.data));
        }
        return true;
      }

      if (message.type === 'CONTROLLER_NETWORK_CHANGE' && message.data) {
        store.dispatch(vaultRehydrate(message.data.vault));
        store.dispatch(setActiveSlip44(message.data.activeSlip44));
        store.dispatch(setNetworkStatus(message.data.networkStatus));
        return true;
      }

      if (message.type === 'CONTROLLER_ACTIVE_ACCOUNT_CHANGE' && message.data) {
        store.dispatch(setActiveAccount(message.data));
        return true;
      }

      if (
        message.type === 'CONTROLLER_ACCOUNT_BALANCE_CHANGE' &&
        message.data
      ) {
        store.dispatch(
          setAccountBalanceSnapshot({
            balances: message.data.balances,
            id: message.data.id,
            nativeBalanceCache: message.data.nativeBalanceCache,
            type: message.data.type,
          })
        );
        return true;
      }

      if (message.type === 'CONTROLLER_STATE_CHANGE' && message.data) {
        // Initial state is hydrated by WalletBootstrap before enabling updates.
        if (isRehydrating) {
          pendingState = message.data;
          return true;
        }

        processState(message.data);
        return true;
      }
      return false;
    }

    chrome.runtime.onMessage.addListener(handleStateChange);

    return () => {
      active = false;
      pendingState = null;
      chrome.runtime.onMessage.removeListener(handleStateChange);
    };
  }, [enabled]);
};
