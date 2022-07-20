import { browser } from 'webextension-polyfill-ts';

import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';

import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import {
  listNewDapp,
  unlistDapp,
  registerListeningSite as registerListeningSiteAction,
  deregisterListeningSite as deregisterListeningSiteAction,
} from 'state/dapp';
import { IDAppInfo } from 'state/dapp/types';
import store from 'state/store';
import { IDAppController } from 'types/controllers';

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
    const { whitelist } = store.getState().dapp;

    return !!whitelist[origin];
  };

  const hasConnectedAccount = () => current.accountId !== null;

  // ! connecting a second page might break the first connection
  const pageConnectDApp = (origin: string, title: string) => {
    current = {
      ...current,
      origin,
      logo: `chrome://favicon/size/64@1x/${origin}`,
      title,
    };

    return isDAppConnected(origin);
  };

  const _userConnectDApp = (
    origin: string,
    dapp: IDAppInfo,
    accountId: number
  ) => {
    current.accountId = accountId;
    store.dispatch(listNewDapp({ id: origin, dapp, accountId }));
  };

  const connectAccount = async (accountId: number) => {
    const origin = current.origin;
    _userConnectDApp(origin, current, accountId);

    _dispatchEvents([new CustomEvent('connect', { detail: { origin } })]);
  };

  const changeConnectedAccount = async (accountId: number) => {
    const origin = current.origin;
    _userConnectDApp(origin, current, accountId);

    _dispatchEvents([new CustomEvent('accountChange', { detail: { origin } })]);
  };

  const _dispatchEvents = async (events: Event[]) => {
    const background = await browser.runtime.getBackgroundPage();

    events.forEach((event) => background.dispatchEvent(event));
  };

  const userDisconnectDApp = (origin: string) => {
    current.accountId = null;
    store.dispatch(unlistDapp({ id: origin }));

    _dispatchEvents([new CustomEvent('disconnect', { detail: { origin } })]);
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

  const getConnectedAccount = (): IKeyringAccountState | undefined => {
    const { accounts } = store.getState().vault;
    return accounts[current.accountId];
  };

  const setSigRequest = (req: ISigRequest) => {
    request = req;
  };

  const getSigRequest = () => request;

  const sysProvider = SysProvider();
  const ethProvider = EthProvider();

  return {
    getCurrent,
    getConnectedAccount,
    hasConnectedAccount,
    pageConnectDApp,
    connectAccount,
    changeConnectedAccount,
    setSigRequest,
    getSigRequest,
    userDisconnectDApp,
    // notifyAccountsChanged,
    registerListeningSite,
    deregisterListeningSite,
    isSiteListening,
    isDAppConnected,
    sysProvider,
    ethProvider,
  };
};

export default DAppController;
