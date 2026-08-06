import store from 'state/store';

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

const getOnlyAccountBalanceChange = (
  previousState: typeof currentState,
  nextState: typeof currentState
) => {
  const previousAccounts = previousState.vault.accounts;
  const nextAccounts = nextState.vault.accounts;
  let balanceChange: any = null;

  const accountTypes = new Set([
    ...Object.keys(previousAccounts),
    ...Object.keys(nextAccounts),
  ]);

  for (const accountType of accountTypes) {
    const previousTypeAccounts = previousAccounts[accountType] || {};
    const nextTypeAccounts = nextAccounts[accountType] || {};

    const accountIds = new Set([
      ...Object.keys(previousTypeAccounts),
      ...Object.keys(nextTypeAccounts),
    ]);

    for (const accountId of accountIds) {
      const previousAccount = previousTypeAccounts[accountId];
      const nextAccount = nextTypeAccounts[accountId];
      if (previousAccount === nextAccount) {
        continue;
      }
      if (
        !previousAccount ||
        !nextAccount ||
        !shallowEqualExcept(previousAccount, nextAccount, [
          'balances',
          'nativeBalanceCache',
        ]) ||
        balanceChange
      ) {
        return null;
      }

      balanceChange = {
        balances: nextAccount.balances,
        id: Number(accountId),
        nativeBalanceCache: nextAccount.nativeBalanceCache,
        type: accountType,
      };
    }
  }

  return balanceChange;
};

export const isNetworkSwitchInProgress = (state: typeof currentState) => {
  if (state.vaultGlobal.networkStatus === 'switching') {
    return true;
  }

  const activeSlip44 = state.vaultGlobal.activeSlip44;
  const vaultSlip44 = state.vault.activeNetwork.slip44;
  return (
    activeSlip44 !== null &&
    vaultSlip44 !== undefined &&
    Number(activeSlip44) !== Number(vaultSlip44)
  );
};

const didCommitNetworkSwitch = (
  previousState: typeof currentState,
  nextState: typeof currentState
) =>
  previousState.vaultGlobal.networkStatus === 'switching' &&
  nextState.vaultGlobal.networkStatus === 'idle' &&
  !isNetworkSwitchInProgress(nextState);

export const sendFastStatePatches = (
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
  const networkChanged =
    previousNetwork.chainId !== nextNetwork.chainId ||
    previousNetwork.url !== nextNetwork.url ||
    previousNetwork.kind !== nextNetwork.kind ||
    previousNetwork.slip44 !== nextNetwork.slip44;
  const networkSwitchCommitted = didCommitNetworkSwitch(
    previousState,
    nextState
  );
  const canPublishVault = !isNetworkSwitchInProgress(nextState);
  const publishedVault =
    canPublishVault && (networkChanged || networkSwitchCommitted);

  if (publishedVault) {
    sendRuntimeMessage({
      type: 'CONTROLLER_NETWORK_CHANGE',
      data: {
        activeSlip44: nextState.vaultGlobal.activeSlip44,
        // A slip44 switch replaces every account-owned bucket, not just the
        // account list. Rehydrate the popup from the exact background vault so
        // imported assets cannot remain stuck on the vault we just left.
        vault: nextState.vault,
        networkStatus: nextState.vaultGlobal.networkStatus,
      },
    });
    sentPatch = true;
  }

  const previousActiveAccount = previousState.vault.activeAccount;
  const nextActiveAccount = nextState.vault.activeAccount;
  const accountBalanceChange =
    canPublishVault &&
    !publishedVault &&
    previousState.vault.accounts !== nextState.vault.accounts
      ? getOnlyAccountBalanceChange(previousState, nextState)
      : null;

  if (
    canPublishVault &&
    !publishedVault &&
    previousState.vault.accounts !== nextState.vault.accounts &&
    !accountBalanceChange
  ) {
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

  if (
    canPublishVault &&
    !publishedVault &&
    (previousActiveAccount.id !== nextActiveAccount.id ||
      previousActiveAccount.type !== nextActiveAccount.type)
  ) {
    sendRuntimeMessage({
      type: 'CONTROLLER_ACTIVE_ACCOUNT_CHANGE',
      data: nextActiveAccount,
    });
    sentPatch = true;
  }

  if (canPublishVault && !publishedVault && accountBalanceChange) {
    sendRuntimeMessage({
      type: 'CONTROLLER_ACCOUNT_BALANCE_CHANGE',
      data: accountBalanceChange,
    });
    sentPatch = true;
  }

  return sentPatch;
};

export const isHotPathOnlyChange = (
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

  const previousNetwork = previousState.vault.activeNetwork;
  const nextNetwork = nextState.vault.activeNetwork;
  const entireVaultWasPatched =
    didCommitNetworkSwitch(previousState, nextState) ||
    previousNetwork.chainId !== nextNetwork.chainId ||
    previousNetwork.url !== nextNetwork.url ||
    previousNetwork.kind !== nextNetwork.kind ||
    previousNetwork.slip44 !== nextNetwork.slip44;

  return (
    sentPatch &&
    (vaultIsActiveAccountOnly || vaultIsAccountsOnly || entireVaultWasPatched)
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
      // Loading a slip44 vault is an intermediate background state. The active
      // keyring and persistence pointer are not committed until the switch
      // succeeds, so never expose this state to the popup.
      if (isNetworkSwitchInProgress(nextState)) {
        pendingState = null;
        return;
      }
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
