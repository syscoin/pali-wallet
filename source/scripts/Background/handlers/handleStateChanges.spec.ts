import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';

import { sendFastStatePatches } from './handleStateChanges';

describe('network state patches', () => {
  beforeEach(() => {
    (chrome.runtime.sendMessage as jest.Mock).mockClear();
  });

  it('delivers a new network and its account buckets atomically', () => {
    const previousState = store.getState();
    const accounts = {
      ...previousState.vault.accounts,
      [KeyringAccountType.HDAccount]: {
        0: {
          ...previousState.vault.accounts[KeyringAccountType.HDAccount][0],
          address: '0x940000000000000000000000000000000000052e',
        },
      },
    };
    const nextState = {
      ...previousState,
      vault: {
        ...previousState.vault,
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
      },
    };

    sendFastStatePatches(previousState, nextState);

    const messages = (chrome.runtime.sendMessage as jest.Mock).mock.calls.map(
      ([message]) => message
    );
    const networkMessage = messages.find(
      (message) => message.type === 'CONTROLLER_NETWORK_CHANGE'
    );

    expect(networkMessage.data.accounts).toBe(accounts);
    expect(
      messages.some((message) => message.type === 'CONTROLLER_ACCOUNTS_CHANGE')
    ).toBe(false);
  });
});
