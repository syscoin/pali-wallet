import EvmBalanceController from './evm';
import SyscoinBalanceController from './syscoin';
import { IBalancesManager } from './types';

const BalancesManager = (): IBalancesManager => ({
  evm: EvmBalanceController(),
  sys: SyscoinBalanceController(),
});

export default BalancesManager;
