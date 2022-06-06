import { KeyringManager, Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { IKeyringAccountState } from '@pollum-io/sysweb3-utils';
import store from 'state/store';
import { utils as SysUtils } from 'syscoinjs-lib';
import { openNotificationsPopup } from 'utils/notifications';

import SysTrezorController from './syscoin';

const TrezorController = () => {
  const { trezor } = KeyringManager();
  const { activeNetwork, networks } = store.getState().vault;

  const isSyscoinNetwork = Boolean(networks.syscoin[activeNetwork.chainId]);

  const account = SysTrezorController();

  const connectHardware = async (): Promise<IKeyringAccountState | any> => {
    const { chainId } = store.getState().vault.activeNetwork;

    if (!(chainId === 57 || chainId === 1)) {
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

    if (!isSyscoinNetwork) return;

    return account.createAccount();
  };

  const forgetHardware = () => {
    // TODO forgetHardware
  };

  return {
    tx: isSyscoinNetwork ? trezor : Web3Accounts(),
    connectHardware,
    forgetHardware,
  };
};

export default TrezorController;
