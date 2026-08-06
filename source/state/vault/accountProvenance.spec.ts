import { INetworkType, KeyringAccountType } from 'types/network';

import reducer, {
  createAccount,
  initializeCleanVaultForSlip44,
  rehydrate,
} from './index';

const bitcoinNetwork = {
  chainId: 0,
  currency: 'btc',
  kind: INetworkType.Syscoin,
  label: 'Bitcoin',
  slip44: 0,
  url: 'https://btc1.trezor.io/',
} as any;

const account = {
  address: 'bc1qaccount',
  id: 0,
  label: 'BTC 1',
  xpub: 'zpub-bitcoin',
} as any;

describe('account slip44 provenance', () => {
  it('stamps newly created accounts with their vault slip44', () => {
    let state = reducer(
      undefined,
      initializeCleanVaultForSlip44(bitcoinNetwork)
    );
    state = reducer(
      state,
      createAccount({ account, accountType: KeyringAccountType.HDAccount })
    );

    expect(state.accounts.HDAccount[0].slip44).toBe(0);
  });

  it('migrates legacy accounts using their persisted vault network', () => {
    let state = reducer(
      undefined,
      initializeCleanVaultForSlip44(bitcoinNetwork)
    );
    state = reducer(
      state,
      createAccount({ account, accountType: KeyringAccountType.HDAccount })
    );
    const legacyState = {
      ...state,
      accounts: {
        ...state.accounts,
        [KeyringAccountType.HDAccount]: {
          0: { ...state.accounts.HDAccount[0], slip44: undefined },
        },
      },
    };

    const migratedState = reducer(state, rehydrate(legacyState));

    expect(migratedState.accounts.HDAccount[0].slip44).toBe(0);
  });
});
