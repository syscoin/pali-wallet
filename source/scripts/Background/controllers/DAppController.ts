import includes from 'lodash/includes';
import filter from 'lodash/filter';
import { browser } from 'webextension-polyfill-ts';
import {
  listNewDapp,
  unlistDapp,
  registerListeningSite as registerListeningSiteAction,
  deregisterListeningSite as deregisterListeningSiteAction,
} from 'state/dapp';
import { IDAppInfo, IDAppState, IDappAccounts } from 'state/dapp/types';
import store from 'state/store';

export interface IDAppController {
  getCurrent: () => IDAppInfo;
  fromUserConnectDApp: (
    origin: string,
    dapp: IDAppInfo,
    network: string,
    accounts: string[]
  ) => void;
  fromUserDisconnectDApp: (origin: string) => void;
  notifyAccountsChanged: (accounts: string[]) => void;
  fromPageConnectDApp: (origin: string, title: string) => boolean;
  setSigRequest: (req: ISigRequest) => void;
  getSigRequest: () => ISigRequest;
  registerListeningSite: (origin: string, eventName: string) => void;
  deregisterListeningSite: (origin: string, eventName: string) => void;
  isSiteListening: (origin: string, eventName: string) => boolean;
  isDAppConnected: (origin: string) => boolean;
}

interface ISigRequest {
  address: string;
  message: string;
  origin: string;
}

const DAppController = (): IDAppController => {
  let current: IDAppInfo = { origin: '', logo: '', title: '' };
  let request: ISigRequest;

  const isDAppConnected = (origin: string) => {
    const { whitelist } = store.getState().dapp;

    return !!whitelist[origin as keyof IDAppState];
  };

  const fromPageConnectDApp = (origin: string, title: string) => {
    current = {
      origin,
      logo: `chrome://favicon/size/64@1x/${origin}`,
      title,
    };

    return isDAppConnected(origin);
  };

  const fromUserConnectDApp = (
    origin: string,
    dapp: IDAppInfo,
    network: string,
    accounts: string[]
  ) => {
    store.dispatch(listNewDapp({ id: origin, dapp, network, accounts }));
  };

  const _dispatchEvents = async (events: any[]) => {
    const background = await browser.runtime.getBackgroundPage();

    events.forEach((event) => background.dispatchEvent(event));
  };

  const notifyAccountsChanged = async (accounts: string[]): Promise<void> => {
    const state = store.getState();
    const { whitelist, listening } = state.dapp;

    let events: any[] = [];

    // Will only notify whitelisted dapps that are listening for a wallet change.
    for (const origin of Object.keys(listening)) {
      const site = whitelist[origin as any];
      const listeningEvents = listening[origin];

      if (!listeningEvents.includes('accountsChanged')) {
        continue;
      }

      if (site) {
        const siteAccounts = site.accounts as IDappAccounts;
        // const allAccountsWithDuplicates = accounts.concat(
        //   siteAccounts.Syscoin,
        //   siteAccounts.Ethereum
        // );
        // const matchingAccounts = filter(
        //   allAccountsWithDuplicates,
        //   (value, index, iteratee) =>
        //     includes(iteratee, value as string, index + 1)
        // );

        // if (matchingAccounts.length) {
        //   const ethAccounts = matchingAccounts.filter((account) =>
        //     account.toLowerCase().startsWith('0x')
        //   );
        //   const dagAccounts = matchingAccounts.filter((account) =>
        //     account.toLowerCase().startsWith('dag')
        //   );

        //   // Dispatch a separate event for each chain
        //   const _events = [
        //     new CustomEvent('accountsChanged', {
        //       detail: { data: ethAccounts, origin, chain: 'ethereum' },
        //     }),
        //     new CustomEvent('accountsChanged', {
        //       detail: { data: dagAccounts, origin, chain: 'constellation' },
        //     }),
        //   ];

        //   events = [...events, ..._events];
        // }
      }
    }

    return _dispatchEvents(events);
  };

  const notifySiteDisconnected = async (origin: string): Promise<void> => {
    console.log('notifySiteDisconnected');
    const state = store.getState();
    const listening: { [origin: string]: Array<string> } = state.dapp.listening;
    const listeningEvents = listening[origin];

    if (!listeningEvents.includes('close')) {
      console.log('notifySiteDisconnected includes close');
      return;
    }

    // Dispatch a separate event for each chain
    const events = [
      new CustomEvent('close', {
        detail: { data: {}, origin, chain: 'ethereum' },
      }),
      new CustomEvent('close', {
        detail: { data: {}, origin, chain: 'constellation' },
      }),
    ];

    console.log('notifySiteDisconnected dispatching: ', events);

    return _dispatchEvents(events);
  };

  const fromUserDisconnectDApp = (origin: string) => {
    notifySiteDisconnected(origin);
    store.dispatch(unlistDapp({ id: origin }));
  };

  const registerListeningSite = (origin: string, eventName: string) => {
    store.dispatch(registerListeningSiteAction({ origin, eventName }));
  };

  const deregisterListeningSite = (origin: string, eventName: string) => {
    store.dispatch(deregisterListeningSiteAction({ origin, eventName }));
  };

  const isSiteListening = (origin: string, eventName: string) => {
    const dapp: IDAppState = store.getState().dapp;

    return dapp.listening[origin] && dapp.listening[origin].includes(eventName);
  };

  const getCurrent = () => {
    return current;
  };

  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => {
    return request;
  };

  return {
    getCurrent,
    fromPageConnectDApp,
    fromUserConnectDApp,
    setSigRequest,
    getSigRequest,
    fromUserDisconnectDApp,
    notifyAccountsChanged,
    registerListeningSite,
    deregisterListeningSite,
    isSiteListening,
    isDAppConnected,
  };
};

export default DAppController;
