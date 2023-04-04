import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import { ITransactionsManager } from './types';

const TransactionsManager = (): ITransactionsManager => ({
  evm: EvmTransactionsController(),
  sys: SysTransactionController(),
});

export default TransactionsManager;
