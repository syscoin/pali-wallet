import { INetworkType } from 'types/network';

import reducer, {
  addDApp,
  removeDApp,
  updateDAppAccount,
  initialState,
} from '.';
import { IDApp } from './types';

/*  ----- Tests ----- */

describe('dapp store actions', () => {
  const FAKE_DAPP: IDApp = {
    host: 'fakehost.net',
    chain: INetworkType.Syscoin,
    chainId: 57,
    accountId: 0,
    accountType: 'HDAccount' as any,
    date: Date.now(),
  };

  //* addDApp
  it('should add a dapp', () => {
    const newState = reducer(initialState, addDApp(FAKE_DAPP));

    expect(newState.dapps[FAKE_DAPP.host]).toEqual(FAKE_DAPP);
  });

  //* removeDApp
  it('should remove a dapp', () => {
    const customState = reducer(initialState, addDApp(FAKE_DAPP));
    const newState = reducer(customState, removeDApp(FAKE_DAPP.host));

    expect(newState.dapps).toEqual(initialState.dapps);
  });

  //* updateDAppAccount
  it('should update the dapp account', () => {
    const payload = {
      host: FAKE_DAPP.host,
      accountId: 1,
      accountType: 'HDAccount' as any,
      date: Date.now(),
    };

    const customState = reducer(initialState, addDApp(FAKE_DAPP));
    const newState = reducer(customState, updateDAppAccount(payload));

    const dapp = newState.dapps[FAKE_DAPP.host];
    expect(dapp.accountId).toEqual(payload.accountId);
  });
});
