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
    //* registerListenerSite
    it('should add a listener', () => {
      const payload = {
        eventName: 'fake event',
        origin: 'fake origin',
      };
      const newState = reducer(initialState, addListener(payload));
      expect(newState.listeners[payload.origin]).toContain(payload.eventName);
    });

    //* deregisterListenerSite
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
      console.log(newState);

      expect(newState.listeners[origin]).toBeUndefined();
    });
  });

  describe('Dapp tests', () => {
    const FAKE_DAPP: IDApp = {
      logo: 'fake logo',
      origin: 'fake origin',
      title: 'fake title',
      accountId: 0,
    };

    const payload = {
      dapp: FAKE_DAPP,
      id: 'fake id',
      accountId: 0,
    };

    //* listNewDapp
    it('should add a dapp', () => {
      const newState = reducer(initialState, addDApp(payload));

      expect(newState.dapps[payload.id]).toEqual({
        ...payload.dapp,
        id: payload.id,
      });
    });

    it('should remove a dapp', () => {
      const customState = reducer(initialState, addDApp(payload));
      const newState = reducer(customState, removeDApp({ id: payload.id }));

      expect(newState.dapps).toEqual(initialState.dapps);
    });
  });
});
