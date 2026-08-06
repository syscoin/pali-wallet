import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';

import {
  isHotPathOnlyChange,
  isNetworkSwitchInProgress,
  sendFastStatePatches,
} from './handleStateChanges';

describe('network state patches', () => {
  beforeEach(() => {
    (chrome.runtime.sendMessage as jest.Mock).mockClear();
  });

  it('withholds an intermediate vault and publishes it on commit', () => {
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
});
