import { getController } from 'utils/browser';
import { browser } from 'webextension-polyfill-ts';
import store from 'state/store';
import store from 'state/store';
import { getConnectedAccount, _getOmittedSensitiveState } from 'utils/index';

export const PaliProvider = () => {
  const connectedAccount = getConnectedAccount('Syscoin');

  const { address, balance, xpub, assets } = connectedAccount;

  const getNetwork = () => store.getState().wallet.activeNetwork;

  const getChainId = () => store.getState().wallet.activeNetwork;

  const getState = () => _getOmittedSensitiveState();

  const sendToken = async (items: any) => {
    const controller = getController();

    const handleSendToken = await controller?.connections?.handleSendToken(
      items
    );

    return handleSendToken;
  };

  const createToken = async (items: any) => {
    const controller = getController();

    const handleCreateToken = await controller?.connections?.handleCreateToken(
      items
    );

    return handleCreateToken;
  };

  const transferToken = async (items: any) => {
    const controller = getController();

    const handleTransferToken =
      await controller?.connections?.handleTransferOwnership(items);

    return handleTransferToken;
  };

  const signPSBT = (psbtToSign: any) => {
    const controller = getController();

    const handleSignPSBT = controller?.connections?.signPSBT(psbtToSign);

    return handleSignPSBT;
  };

  const getSignedPSBT = (psbtToSign: any) => {
    const controller = getController();

    return controller?.connections?.signPSBT(psbtToSign);
  };

  const notifyWalletChanges = async (): Promise<void> => {
    const { activeNetworkType } = store.getState().wallet;
    const { ...walletInfo } = store.getState().wallet;
    const background = await browser.runtime.getBackgroundPage();

    const _dispatchEvent = (): void => {
      background.dispatchEvent(
        new CustomEvent('walletChanged', {
          detail: {
            data: { ...walletInfo },
            chain: 'ethereum',
          },
        })
      );
    };

    if (activeNetworkType === 'web3') {
      const subscribe = store.subscribe(_dispatchEvent);
      return subscribe();
    }

    console.log('building...');
  };

  return {
    connectedAccount,
    balance,
    address,
    xpub,
    assets,
    getNetwork,
    getChainId,
    getState,
    sendToken,
    createToken,
    transferToken,
    signPSBT,
    getSignedPSBT,
    notifyWalletChanges,
  };
};
