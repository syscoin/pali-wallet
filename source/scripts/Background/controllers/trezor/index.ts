import store from 'state/store';
import EthTrezorController from './ethereum';
import SysTrezorController from './syscoin';

const TrezorController = () => {
  const { activeNetwork } = store.getState().vault;

  const isSyscoinNetwork = activeNetwork.chainId === 57;

  const connectHardware = () => {};

  const forgetHardware = () => {};

  return {
    tx: isSyscoinNetwork ? SysTrezorController : EthTrezorController,
    connectHardware,
    forgetHardware,
  };
};

export default TrezorController;
