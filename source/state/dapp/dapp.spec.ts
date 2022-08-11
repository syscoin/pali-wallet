import reducer, {
  addListener,
  removeListener,
  addDApp,
  removeDApp,
  updateDAppAccount,
  initialState,
  removeListeners,
} from '.';
import { IDApp } from './types';

/*  ----- Tests ----- */

describe('dapp store actions', () => {
  describe('Listeners tests', () => {
    //* addListener
    it('should add a listener', () => {
      const payload = {
        eventName: 'fake event',
        host: 'fake host',
      };
      const newState = reducer(initialState, addListener(payload));
      expect(newState.listeners[payload.host]).toContain(payload.eventName);
    });

    //* removeListener
    it('should remove a listener ', () => {
      const payload = {
        eventName: 'fake event',
        host: 'fake host',
      };

      const customState = reducer(initialState, addListener(payload));

      const newState = reducer(customState, removeListener(payload));

      expect(newState.listeners).not.toContain(payload.host);
    });

    //* removeListeners
    it('should remove a listener ', () => {
      const host = 'hostname.com';
      const event1 = { eventName: 'event1', host };
      const event2 = { eventName: 'event2', host };

      let customState = reducer(initialState, addListener(event1));
      customState = reducer(customState, addListener(event2));

      const newState = reducer(customState, removeListeners(host));

      expect(newState.listeners[host]).toBeUndefined();
    });
  });

  // TODO update dapp tests
  describe('Dapp tests', () => {
    const FAKE_DAPP: IDApp = {
      host: 'fakehost.net',
      chain: 'syscoin',
      chainId: 57,
      accountId: 0,
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
    it('should remove a dapp', () => {
      const payload = { host: FAKE_DAPP.host, accountId: 1 };

      const customState = reducer(initialState, addDApp(FAKE_DAPP));
      const newState = reducer(customState, updateDAppAccount(payload));

      const dapp = newState.dapps[FAKE_DAPP.host];
      expect(dapp.accountId).toEqual(payload.accountId);
    });
  });
});
