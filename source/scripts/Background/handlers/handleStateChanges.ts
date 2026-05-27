import store from 'state/store';
import { INetworkType } from 'types/network';

let currentState = store.getState();
let pendingState: typeof currentState | null = null;
let stateBroadcastTimeout: ReturnType<typeof setTimeout> | null = null;

const STATE_BROADCAST_DEBOUNCE_MS = 50;

const sendRuntimeMessage = (message: any) => {
  chrome.runtime.sendMessage(message, () => {
    // Popup may close or navigate while a background update is in flight.
    // Consume lastError so MV3 promise-style warnings do not surface as uncaught.
    void chrome.runtime.lastError;
  });
};

const sendStateToPopup = (nextState: typeof currentState) => {
  chrome.runtime.sendMessage(
    {
      type: 'CONTROLLER_STATE_CHANGE',
      data: nextState,
    },
    () => {
      // Check for quota exceeded error
      if (chrome.runtime.lastError) {
        if (
          chrome.runtime.lastError.message?.includes('exceeded') ||
          chrome.runtime.lastError.message?.includes('quota') ||
          chrome.runtime.lastError.message?.includes('too large')
        ) {
          console.error(
            '[State] State too large to send:',
            chrome.runtime.lastError.message
          );
          // Could implement chunking or send minimal state here
        }
        // ignore other errors when extension is closed
      }
    }
  );
};

const scheduleStateBroadcast = (nextState: typeof currentState) => {
  pendingState = nextState;

  if (stateBroadcastTimeout) {
    return;
  }

  stateBroadcastTimeout = setTimeout(() => {
    stateBroadcastTimeout = null;

    if (!pendingState) {
      return;
    }

    const stateToSend = pendingState;
    pendingState = null;
    sendStateToPopup(stateToSend);
  }, STATE_BROADCAST_DEBOUNCE_MS);
};

const sendFastStatePatches = (
  previousState: typeof currentState,
  nextState: typeof currentState
): boolean => {
  let sentPatch = false;
  if (previousState.dapp !== nextState.dapp) {
    sendRuntimeMessage({
      type: 'CONTROLLER_DAPP_STATE_CHANGE',
      data: nextState.dapp,
    });
    sentPatch = true;
  }

  const previousNetwork = previousState.vault.activeNetwork;
  const nextNetwork = nextState.vault.activeNetwork;

  if (
    previousNetwork.chainId !== nextNetwork.chainId ||
    previousNetwork.url !== nextNetwork.url ||
    previousNetwork.kind !== nextNetwork.kind
  ) {
    sendRuntimeMessage({
      type: 'CONTROLLER_NETWORK_CHANGE',
      data: {
        activeAccount: nextState.vault.activeAccount,
        activeNetwork: nextNetwork,
        accounts: nextState.vault.accounts,
        networkStatus: nextState.vaultGlobal.networkStatus,
      },
    });
    sentPatch = true;
  }

  if (previousState.vault.accounts !== nextState.vault.accounts) {
    sendRuntimeMessage({
      type: 'CONTROLLER_ACCOUNTS_CHANGE',
      data: nextState.vault.accounts,
    });
    sentPatch = true;
  }

  if (
    previousState.vaultGlobal.networkStatus !==
      nextState.vaultGlobal.networkStatus ||
    previousState.vaultGlobal.networkTarget !==
      nextState.vaultGlobal.networkTarget ||
    previousState.vaultGlobal.isPostNetworkSwitchLoading !==
      nextState.vaultGlobal.isPostNetworkSwitchLoading ||
    previousState.vaultGlobal.networkQuality !==
      nextState.vaultGlobal.networkQuality ||
    previousState.vaultGlobal.isSwitchingAccount !==
      nextState.vaultGlobal.isSwitchingAccount ||
    previousState.vaultGlobal.isPollingUpdate !==
      nextState.vaultGlobal.isPollingUpdate
  ) {
    sendRuntimeMessage({
      type: 'CONTROLLER_NETWORK_STATUS_CHANGE',
      data: {
        isPostNetworkSwitchLoading:
          nextState.vaultGlobal.isPostNetworkSwitchLoading,
        isPollingUpdate: nextState.vaultGlobal.isPollingUpdate,
        isSwitchingAccount: nextState.vaultGlobal.isSwitchingAccount,
        networkQuality: nextState.vaultGlobal.networkQuality,
        networkStatus: nextState.vaultGlobal.networkStatus,
        networkTarget: nextState.vaultGlobal.networkTarget,
      },
    });
    sentPatch = true;
  }

  const previousActiveAccount = previousState.vault.activeAccount;
  const nextActiveAccount = nextState.vault.activeAccount;

  if (
    previousActiveAccount.id !== nextActiveAccount.id ||
    previousActiveAccount.type !== nextActiveAccount.type
  ) {
    sendRuntimeMessage({
      type: 'CONTROLLER_ACTIVE_ACCOUNT_CHANGE',
      data: nextActiveAccount,
    });
    sentPatch = true;
  }

  const previousAccount =
    previousState.vault.accounts[nextActiveAccount.type]?.[
      nextActiveAccount.id
    ];
  const nextAccount =
    nextState.vault.accounts[nextActiveAccount.type]?.[nextActiveAccount.id];

  const networkType = nextState.vault.isBitcoinBased
    ? INetworkType.Syscoin
    : INetworkType.Ethereum;
  const previousBalance = previousAccount?.balances?.[networkType];
  const nextBalance = nextAccount?.balances?.[networkType];

  if (previousBalance !== nextBalance && nextAccount?.balances) {
    sendRuntimeMessage({
      type: 'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
      data: {
        id: nextActiveAccount.id,
        type: nextActiveAccount.type,
        balances: nextAccount.balances,
      },
    });
    sentPatch = true;
  }

  return sentPatch;
};

const shallowEqualExcept = (
  previousValue: Record<string, any>,
  nextValue: Record<string, any>,
  ignoredKeys: string[]
) => {
  const ignored = new Set(ignoredKeys);
  const keys = new Set([
    ...Object.keys(previousValue || {}),
    ...Object.keys(nextValue || {}),
  ]);

  for (const key of keys) {
    if (ignored.has(key)) {
      continue;
    }

    if (previousValue?.[key] !== nextValue?.[key]) {
      return false;
    }
  }

  return true;
};

const isHotPathOnlyChange = (
  previousState: typeof currentState,
  nextState: typeof currentState,
  sentPatch: boolean
) => {
  if (previousState.price !== nextState.price) {
    return false;
  }

  if (previousState.spamFilter !== nextState.spamFilter) {
    return false;
  }

  const vaultGlobalIsHotOnly =
    previousState.vaultGlobal === nextState.vaultGlobal ||
    shallowEqualExcept(previousState.vaultGlobal, nextState.vaultGlobal, [
      'isPollingUpdate',
      'isSwitchingAccount',
      'isPostNetworkSwitchLoading',
      'networkQuality',
      'networkStatus',
      'networkTarget',
    ]);

  if (!vaultGlobalIsHotOnly) {
    return false;
  }

  if (previousState.vault === nextState.vault) {
    return true;
  }

  const vaultIsActiveAccountOnly = shallowEqualExcept(
    previousState.vault,
    nextState.vault,
    ['activeAccount']
  );

  const vaultIsAccountsOnly = shallowEqualExcept(
    previousState.vault,
    nextState.vault,
    ['accounts']
  );

  const vaultIsNetworkSwitchOnly = shallowEqualExcept(
    previousState.vault,
    nextState.vault,
    [
      'accounts',
      'activeAccount',
      'activeChain',
      'activeNetwork',
      'isBitcoinBased',
    ]
  );

  return (
    sentPatch &&
    (vaultIsActiveAccountOnly ||
      vaultIsAccountsOnly ||
      vaultIsNetworkSwitchOnly)
  );
};

export function handleObserveStateChanges() {
  store.subscribe(() => {
    const nextState = store.getState();
    // Use simple reference equality - Redux creates new state objects on changes
    // This is much more efficient than JSON.stringify comparison
    if (currentState !== nextState) {
      const previousState = currentState;
      currentState = nextState;
      const sentPatch = sendFastStatePatches(previousState, nextState);
      if (isHotPathOnlyChange(previousState, nextState, sentPatch)) {
        if (pendingState) {
          pendingState = nextState;
        }
        return;
      }
      scheduleStateBroadcast(nextState);
    }
  });
}
