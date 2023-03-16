import EvmAssetsController from './evm';
import SysAssetsController from './syscoin';
import { IEvmAssetsController, ISysAssetsController } from './types';

export interface IAssetsManager {
  evm: IEvmAssetsController;
  sys: ISysAssetsController;
}

const AssetsManager = (): IAssetsManager => ({
  evm: EvmAssetsController(),
  sys: SysAssetsController(),
});

export default AssetsManager;
