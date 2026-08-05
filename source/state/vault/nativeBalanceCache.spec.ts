import type { INetwork } from 'types/network';
import { INetworkType, KeyringAccountType } from 'types/network';
import { NATIVE_BALANCE_CACHE_TTL_MS } from 'utils/nativeBalanceCache';

import vaultReducer, {
  setAccountBalanceForNetwork,
  setNetworkChange,
} from './index';

const evmNetwork = (chainId: number): INetwork => ({
  chainId,
  currency: 'SYS',
  kind: INetworkType.Ethereum,
  label: `EVM ${chainId}`,
  slip44: 60,
  url: `https://rpc-${chainId}.example`,
});

const getHdAccount = (state: ReturnType<typeof vaultReducer>) =>
  state.accounts[KeyringAccountType.HDAccount][0];

describe('network native balance cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores a fresh balance when returning to a previously visited network', () => {
    const now = 1_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const firstNetwork = evmNetwork(57_057);
    const secondNetwork = evmNetwork(57_058);

    let state = vaultReducer(undefined, { type: 'test/init' });
    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: firstNetwork })
    );
    state = vaultReducer(
      state,
      setAccountBalanceForNetwork({
        balance: '12.5',
        id: 0,
        network: firstNetwork,
        type: KeyringAccountType.HDAccount,
        updatedAt: now,
      })
    );
    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: secondNetwork })
    );

    expect(getHdAccount(state).balances.ethereum).toBe(-1);
    state = vaultReducer(
      state,
      setAccountBalanceForNetwork({
        balance: '7.25',
        id: 0,
        network: secondNetwork,
        type: KeyringAccountType.HDAccount,
        updatedAt: now,
      })
    );

    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: firstNetwork })
    );

    expect(getHdAccount(state).balances.ethereum).toBe('12.5');

    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: secondNetwork })
    );
    expect(getHdAccount(state).balances.ethereum).toBe('7.25');
  });

  it('uses the missing sentinel instead of restoring an expired balance', () => {
    const updatedAt = 1_000_000;
    const firstNetwork = evmNetwork(57_057);
    const secondNetwork = evmNetwork(57_058);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(updatedAt);

    let state = vaultReducer(undefined, { type: 'test/init' });
    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: firstNetwork })
    );
    state = vaultReducer(
      state,
      setAccountBalanceForNetwork({
        balance: '12.5',
        id: 0,
        network: firstNetwork,
        type: KeyringAccountType.HDAccount,
        updatedAt,
      })
    );

    nowSpy.mockReturnValue(updatedAt + NATIVE_BALANCE_CACHE_TTL_MS);
    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: secondNetwork })
    );
    state = vaultReducer(
      state,
      setNetworkChange({ activeNetwork: firstNetwork })
    );

    expect(getHdAccount(state).balances.ethereum).toBe(-1);
  });
});
