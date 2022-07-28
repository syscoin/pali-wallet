import reducer, {
  addListener,
  removeListener,
  addDApp,
  removeDApp,
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
        origin: 'fake origin',
      };
      const newState = reducer(initialState, addListener(payload));
      expect(newState.listeners[payload.origin]).toContain(payload.eventName);
    });

    //* removeListener
    it('should remove a listener ', () => {
      const payload = {
        eventName: 'fake event',
        origin: 'fake origin',
      };

      const customState = reducer(initialState, addListener(payload));

      const newState = reducer(customState, removeListener(payload));

      expect(newState.listeners).not.toContain(payload.origin);
    });

    //* removeListeners
    it('should remove a listener ', () => {
      const origin = 'originname.com';
      const event1 = { eventName: 'event1', origin };
      const event2 = { eventName: 'event2', origin };

      let customState = reducer(initialState, addListener(event1));
      customState = reducer(customState, addListener(event2));

      const newState = reducer(customState, removeListeners(origin));

      expect(newState.listeners[origin]).toBeUndefined();
    });
  });

  describe('Dapp tests', () => {
    const FAKE_DAPP: IDApp = {
      origin: 'fake origin',
      title: 'fake title',
      accountId: 0,
    };

    //* addDApp
    it('should add a dapp', () => {
      const newState = reducer(initialState, addDApp(FAKE_DAPP));

      expect(newState.dapps[FAKE_DAPP.origin]).toEqual(FAKE_DAPP);
    });

    //* removeDApp
    it('should remove a dapp', () => {
      const customState = reducer(initialState, addDApp(FAKE_DAPP));
      const newState = reducer(customState, removeDApp(FAKE_DAPP.origin));

      expect(newState.dapps).toEqual(initialState.dapps);
    });
  });
});
