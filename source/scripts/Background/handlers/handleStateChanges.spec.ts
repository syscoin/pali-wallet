import { setPrices } from 'state/price';
import store from 'state/store';
import { setNetworkChange } from 'state/vault';
import {
  setActiveSlip44,
  startSwitchNetwork,
  switchNetworkSuccess,
} from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import {
  handleObserveStateChanges,
  isHotPathOnlyChange,
  isNetworkSwitchInProgress,
  sendFastStatePatches,
} from './handleStateChanges';

describe('network state patches', () => {
  let unsubscribeStateChanges: (() => void) | undefined;

  beforeEach(() => {
    (chrome.runtime.sendMessage as jest.Mock).mockClear();
  });

  afterEach(() => {
    unsubscribeStateChanges?.();
    unsubscribeStateChanges = undefined;
    jest.useRealTimers();
  });

  it('withholds an intermediate vault and publishes it on terminal alignment', () => {
    const initialState = store.getState();
    const previousState = {
      ...initialState,
      vaultGlobal: {
        ...initialState.vaultGlobal,
        activeSlip44: initialState.vault.activeNetwork.slip44,
        networkStatus: 'idle' as const,
      },
    };
    const accounts = {
      ...previousState.vault.accounts,
      [KeyringAccountType.HDAccount]: {
        0: {
          ...previousState.vault.accounts[KeyringAccountType.HDAccount][0],
          address: '0x940000000000000000000000000000000000052e',
        },
      },
    };
    const accountAssets = {
      ...previousState.vault.accountAssets,
      [KeyringAccountType.HDAccount]: {
        0: {
          ethereum: [
            {
              balance: 0,
              chainId: 570,
              contractAddress: '0x0000000000000000000000000000000000000001',
              decimals: 18,
              isNft: false,
              tokenSymbol: 'TEST',
            },
          ],
          syscoin: [],
        },
      },
    };
    const accountTransactions = {
      ...previousState.vault.accountTransactions,
      [KeyringAccountType.HDAccount]: {
        0: { ethereum: { 570: [] }, syscoin: {} },
      },
    };
    const targetVault = {
      ...previousState.vault,
      accountAssets,
      accountTransactions,
      accounts,
      activeChain: INetworkType.Ethereum,
      activeNetwork: {
        ...previousState.vault.activeNetwork,
        chainId: 570,
        kind: INetworkType.Ethereum,
        slip44: 60,
        url: 'https://rpc.rollux.com',
      },
      isBitcoinBased: false,
    };
    const switchingState = {
      ...previousState,
      vault: targetVault,
      vaultGlobal: {
        ...previousState.vaultGlobal,
        networkStatus: 'switching' as const,
        networkTarget: targetVault.activeNetwork,
      },
    };

    sendFastStatePatches(previousState, switchingState);

    const switchingMessages = (
      chrome.runtime.sendMessage as jest.Mock
    ).mock.calls.map(([message]) => message);
    expect(isNetworkSwitchInProgress(switchingState)).toBe(true);
    expect(
      switchingMessages.some(
        (message) => message.type === 'CONTROLLER_NETWORK_CHANGE'
      )
    ).toBe(false);
    expect(
      switchingMessages.some(
        (message) => message.type === 'CONTROLLER_ACCOUNTS_CHANGE'
      )
    ).toBe(false);

    (chrome.runtime.sendMessage as jest.Mock).mockClear();
    const keyringCommittedState = {
      ...switchingState,
      vaultGlobal: {
        ...switchingState.vaultGlobal,
        activeSlip44: 60,
      },
    };
    sendFastStatePatches(switchingState, keyringCommittedState);
    expect(isNetworkSwitchInProgress(keyringCommittedState)).toBe(true);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    const failedState = {
      ...keyringCommittedState,
      vaultGlobal: {
        ...keyringCommittedState.vaultGlobal,
        networkStatus: 'error' as const,
      },
    };
    const failureSentPatch = sendFastStatePatches(
      keyringCommittedState,
      failedState
    );
    const failureMessages = (
      chrome.runtime.sendMessage as jest.Mock
    ).mock.calls.map(([message]) => message);
    const failureNetworkMessage = failureMessages.find(
      (message) => message.type === 'CONTROLLER_NETWORK_CHANGE'
    );

    expect(isNetworkSwitchInProgress(failedState)).toBe(false);
    expect(failureNetworkMessage.data.activeSlip44).toBe(60);
    expect(failureNetworkMessage.data.vault).toBe(targetVault);
    expect(failureNetworkMessage.data.networkStatus).toBe('error');
    expect(
      isHotPathOnlyChange(keyringCommittedState, failedState, failureSentPatch)
    ).toBe(true);

    (chrome.runtime.sendMessage as jest.Mock).mockClear();
    const committedState = {
      ...keyringCommittedState,
      vaultGlobal: {
        ...keyringCommittedState.vaultGlobal,
        networkStatus: 'idle' as const,
        networkTarget: undefined,
      },
    };
    const sentPatch = sendFastStatePatches(
      keyringCommittedState,
      committedState
    );
    const committedMessages = (
      chrome.runtime.sendMessage as jest.Mock
    ).mock.calls.map(([message]) => message);
    const networkMessage = committedMessages.find(
      (message) => message.type === 'CONTROLLER_NETWORK_CHANGE'
    );

    expect(isNetworkSwitchInProgress(committedState)).toBe(false);
    expect(networkMessage.data.activeSlip44).toBe(60);
    expect(networkMessage.data.vault).toBe(targetVault);
    expect(networkMessage.data.vault.accounts).toBe(accounts);
    expect(networkMessage.data.vault.accountAssets).toBe(accountAssets);
    expect(networkMessage.data.vault.accountTransactions).toBe(
      accountTransactions
    );
    expect(
      committedMessages.some(
        (message) => message.type === 'CONTROLLER_ACCOUNTS_CHANGE'
      )
    ).toBe(false);
    expect(
      isHotPathOnlyChange(keyringCommittedState, committedState, sentPatch)
    ).toBe(true);
  });

  it('keeps a switch-only vault hydration on the patch fast path', () => {
    jest.useFakeTimers();
    unsubscribeStateChanges = handleObserveStateChanges();
    const currentVault = store.getState().vault;
    const targetSlip44 = currentVault.activeNetwork.slip44 === 60 ? 57 : 60;
    const targetNetwork = {
      ...currentVault.activeNetwork,
      chainId: Number(currentVault.activeNetwork.chainId) + 1,
      slip44: targetSlip44,
      url: 'https://target-switch.example',
    };

    store.dispatch(startSwitchNetwork(targetNetwork));
    store.dispatch(setNetworkChange({ activeNetwork: targetNetwork }));
    store.dispatch(setActiveSlip44(targetSlip44));
    store.dispatch(switchNetworkSuccess());
    jest.runOnlyPendingTimers();

    const messages = (chrome.runtime.sendMessage as jest.Mock).mock.calls.map(
      ([message]) => message
    );
    expect(
      messages.some((message) => message.type === 'CONTROLLER_NETWORK_CHANGE')
    ).toBe(true);
    expect(
      messages.some((message) => message.type === 'CONTROLLER_STATE_CHANGE')
    ).toBe(false);
  });

  it('delivers non-patchable updates deferred during a network switch', () => {
    jest.useFakeTimers();
    unsubscribeStateChanges = handleObserveStateChanges();
    const targetNetwork = store.getState().vault.activeNetwork;

    store.dispatch(startSwitchNetwork(targetNetwork));
    store.dispatch(
      setPrices({
        asset: 'usd',
        price: 123,
      })
    );

    expect(
      (chrome.runtime.sendMessage as jest.Mock).mock.calls.some(
        ([message]) => message.type === 'CONTROLLER_STATE_CHANGE'
      )
    ).toBe(false);

    store.dispatch(switchNetworkSuccess());
    jest.runOnlyPendingTimers();

    const fullStateMessage = (
      chrome.runtime.sendMessage as jest.Mock
    ).mock.calls.find(
      ([message]) => message.type === 'CONTROLLER_STATE_CHANGE'
    )?.[0];

    expect(fullStateMessage.data.price.fiat).toEqual({
      asset: 'usd',
      price: 123,
    });
  });
});
