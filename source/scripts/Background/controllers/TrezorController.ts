import store from 'state/store';
import sys from 'syscoinjs-lib';
import { openNotificationsPopup } from 'utils/index';

const TrezorController = ({ account }) => {
  const connectHardware = async (): Promise<void> => {
    const isTestnet = store.getState().vault.activeNetwork.chainId === 5700;

    if (isTestnet) {
      return openNotificationsPopup(
        "Can't create hardware wallet on testnet",
        "Trezor doesn't support SYS testnet"
      );
    }

    const trezorSigner = new sys.utils.TrezorSigner();

    await trezorSigner.createAccount();

    openNotificationsPopup(
      'Hardware Wallet connected',
      'Trezor Wallet account created'
    );

    await account.subscribeAccount(true, trezorSigner, undefined, false);

    await account.updateTokensState();
  };

  return {
    connectHardware,
  };
};

export default TrezorController;
