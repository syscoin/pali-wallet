import { browser } from 'webextension-polyfill-ts';

import { useUtils, useQuery } from 'hooks/index';
import { getController } from 'utils/browser';

export const useDappConnection = () => {
  const {
    dapp,
    wallet: { account },
  } = getController();

  const { alert } = useUtils();
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
    try {
      await browser.runtime.sendMessage({
        type: 'CHANGE_CONNECTED_ACCOUNT',
        target: 'background',
        id: accountId,
        url: origin,
      });

      // await closePopup();
      window.close();

      await account.updateTokensState();
    } catch (error) {
      alert.removeAll();
      alert.error('Error changing account. Try again.');
    }
  };

  return {
    confirmConnection,
    changeConnectedAccount,
  };
};
