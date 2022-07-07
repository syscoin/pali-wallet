import { browser } from 'webextension-polyfill-ts';

import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';

import { EthereumProvider } from 'scripts/Provider/EthereumProvider';
import { PaliProvider } from 'scripts/Provider/PaliProvider';
import {
  listNewDapp,
  unlistDapp,
  registerListeningSite as registerListeningSiteAction,
  deregisterListeningSite as deregisterListeningSiteAction,
} from 'state/dapp';
import { IDAppInfo } from 'state/dapp/types';
import store from 'state/store';
import { IDAppController } from 'types/controllers';
import { getHost } from 'utils/index';
import { log } from 'utils/logger';

export interface ISigRequest {
  address: string;
  message: string;
  origin: string;
}

const DAppController = (): IDAppController => {
  let current: IDAppInfo = {
    accountId: null,
    origin: '',
    logo: '',
    title: '',
  };
  let request: ISigRequest;

  const isDAppConnected = (origin: string) => {
    if (origin.startsWith('https://')) {
      origin = getHost(origin);
    }

    const { whitelist } = store.getState().dapp;

    return !!whitelist[origin];
  };

  const hasConnectedAccount = () => current.accountId !== null;

  const pageConnectDApp = (origin: string, title: string) => {
    current = {
      ...current,
      origin,
      logo: `chrome://favicon/size/64@1x/${origin}`,
      title,
    };

    return isDAppConnected(origin);
  };

  const userConnectDApp = (
    origin: string,
    dapp: IDAppInfo,
    accountId: number
  ) => {
    current.accountId = accountId;
    store.dispatch(listNewDapp({ id: origin, dapp, accountId }));
  };

  const _dispatchEvents = async (events: Event[]) => {
    const background = await browser.runtime.getBackgroundPage();

    events.forEach((event) => background.dispatchEvent(event));
  };

  const notifyAccountsChanged = async (accountId: number): Promise<void> => {
    const { whitelist, listening } = store.getState().dapp;

    let events: Event[] = [];

    // Will only notify whitelisted dapps that are listening for a wallet change.
    for (const origin of Object.keys(listening)) {
      const site = whitelist[origin as string];
      const listeningEvents = listening[origin];

      if (!listeningEvents.includes('accountsChanged')) {
        return;
      }

      if (site) {
        // Dispatch a separate event for each chain
        const _events = [
          new CustomEvent('accountsChanged', {
            detail: { data: accountId, origin, chain: 'ethereum' },
          }),
          new CustomEvent('accountsChanged', {
            detail: { data: accountId, origin, chain: 'syscoin' },
          }),
        ];

        events = [...events, ..._events];
      }
    }

    _dispatchEvents(events);
  };

  const _notifySiteDisconnected = async (origin: string): Promise<void> => {
    const { listening } = store.getState().dapp;

    const listeningEvents = listening[origin];

    if (!listeningEvents.includes('close')) {
      log('notifySiteDisconnected includes close', 'Connection');

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

    _dispatchEvents(events);
  };

  const userDisconnectDApp = (origin: string) => {
    _notifySiteDisconnected(origin);
    current.accountId = null;
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

  const getConnectedAccount = (): IKeyringAccountState | null => {
    if (current.accountId === -1) return null;

    const { accounts } = store.getState().vault;
    return accounts[current.accountId];
  };

  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => request;

  const paliProvider = PaliProvider();
  const ethereumProvider = EthereumProvider();

  return {
    getCurrent,
    getConnectedAccount,
    hasConnectedAccount,
    pageConnectDApp,
    userConnectDApp,
    setSigRequest,
    getSigRequest,
    userDisconnectDApp,
    notifyAccountsChanged,
    registerListeningSite,
    deregisterListeningSite,
    isSiteListening,
    isDAppConnected,
    paliProvider,
    ethereumProvider,
  };
};

export default DAppController;
