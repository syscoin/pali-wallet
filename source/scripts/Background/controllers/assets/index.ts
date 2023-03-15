import EvmAssetsController, { IEvmAssetsController } from './evm';
import SysAssetsController, { ISysAssetsController } from './syscoin';

export interface IAssetsManager {
  evm: IEvmAssetsController;
  sys: ISysAssetsController;
}

const AssetsManager = (): IAssetsManager => ({
  evm: EvmAssetsController(),
  sys: SysAssetsController(),
});

export default AssetsManager;
