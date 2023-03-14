import EvmAssetsController from './evm';
import SysAssetsController from './syscoin';
import store from 'state/store';

const AssetsManager = () => {
  const { isBitcoinBased } = store.getState().vault;

  switch (isBitcoinBased) {
    case true:
      return SysAssetsController();
    case false:
      return EvmAssetsController();
    default:
      return SysAssetsController();
  }
};

export default AssetsManager;
