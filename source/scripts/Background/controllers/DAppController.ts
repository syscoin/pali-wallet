import { browser } from 'webextension-polyfill-ts';
import {
  listNewDapp,
  unlistDapp,
  registerListeningSite as registerListeningSiteAction,
  deregisterListeningSite as deregisterListeningSiteAction,
} from 'state/dapp';
import { IDAppInfo } from 'state/dapp/types';
import store from 'state/store';

export interface IDAppController {
  deregisterListeningSite: (origin: string, eventName: string) => void;
  fromUserDisconnectDApp: (origin: string) => void;
  getCurrent: () => IDAppInfo;
  getSigRequest: () => ISigRequest;
  isDAppConnected: (origin: string) => boolean;
  isSiteListening: (origin: string, eventName: string) => boolean;
  notifyAccountsChanged: (accounts: string[]) => void;
  pageConnectDApp: (origin: string, title: string) => boolean;
  registerListeningSite: (origin: string, eventName: string) => void;
  setSigRequest: (req: ISigRequest) => void;
  userConnectDApp: (
    origin: string,
    dapp: IDAppInfo,
    network: string,
    accounts: string[]
  ) => void;
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

    return Object.keys(whitelist).includes(origin);
  };

  const pageConnectDApp = (origin: string, title: string) => {
    current = {
      origin,
      logo: `chrome://favicon/size/64@1x/${origin}`,
      title,
    };

    return isDAppConnected(origin);
  };

  const userConnectDApp = (
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

    const events: any[] = [];

    // Will only notify whitelisted dapps that are listening for a wallet change.
    for (const origin of Object.keys(listening)) {
      const site = whitelist[origin as any];
      const listeningEvents = listening[origin];

      if (!listeningEvents.includes('accountsChanged')) {
        return;
      }

      if (site) {
        console.log('accounts', accounts);
        // const siteAccounts = site.accounts as IDappAccounts;
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
        //   const sysAccounts = matchingAccounts.filter((account) =>
        //     account.toLowerCase().startsWith('sys')
        //   );
        //   // Dispatch a separate event for each chain
        //   const _events = [
        //     new CustomEvent('accountsChanged', {
        //       detail: { data: ethAccounts, origin, chain: 'ethereum' },
        //     }),
        //     new CustomEvent('accountsChanged', {
        //       detail: { data: sysAccounts, origin, chain: 'syscoin' },
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

    const { listening } = store.getState().dapp;

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
        detail: { data: {}, origin, chain: 'syscoin' },
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
    const { dapp } = store.getState();

    return dapp.listening[origin] && dapp.listening[origin].includes(eventName);
  };

  const getCurrent = () => current;

  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => request;

  return {
    getCurrent,
    pageConnectDApp,
    userConnectDApp,
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
