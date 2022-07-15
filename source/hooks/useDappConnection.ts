import { browser } from 'webextension-polyfill-ts';

import { useQuery } from 'hooks/useQuery';
import { getController } from 'utils/browser';

export const useDappConnection = () => {
  const { dapp } = getController();

  const query = useQuery();

  const current = dapp.getCurrent();
  const origin = current && current.origin;

  const confirmConnection = async (accountId: number) => {
    dapp.userConnectDApp(origin, current, accountId);

    const background = await browser.runtime.getBackgroundPage();

    const windowId = query.get('windowId');

    background.dispatchEvent(
      new CustomEvent('connectWallet', { detail: { windowId, accountId } })
    );

    window.close();
  };

  const changeConnectedAccount = async (accountId: number) => {
    dapp.userConnectDApp(origin, current, accountId);

    window.close();
  };

  return {
    confirmConnection,
    changeConnectedAccount,
  };
};
