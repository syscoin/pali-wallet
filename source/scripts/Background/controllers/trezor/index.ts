import store from 'state/store';
import { utils as SysUtils } from 'syscoinjs-lib';
import { openNotificationsPopup } from 'utils/notifications';
import EthTrezorController from './ethereum';
import SysTrezorController from './syscoin';

const TrezorController = () => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const { account } = window.controller.wallet;

  const connectHardware = async (): Promise<void> => {
    const isTestnet = store.getState().vault.activeNetwork.chainId === 5700;

    if (isTestnet) {
      return openNotificationsPopup(
        "Can't create hardware wallet on testnet",
        "Trezor doesn't support SYS testnet"
      );
    }

    const trezorSigner = new SysUtils.TrezorSigner();

    await trezorSigner.createAccount();

    openNotificationsPopup(
      'Hardware Wallet connected',
      'Trezor Wallet account created'
    );

    await account.subscribeAccount(true, trezorSigner, undefined, false);

    await account.updateTokensState();
  };

  const forgetHardware = () => {};

  return {
    tx: isSyscoinNetwork ? SysTrezorController() : EthTrezorController(),
    connectHardware,
    forgetHardware,
  };
};

export default TrezorController;
