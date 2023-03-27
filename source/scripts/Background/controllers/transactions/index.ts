import EvmTransactionsController from './evm';
import SysTransactionController from './syscoin';
import {
  IEvmTransactionsController,
  ISysTransactionsController,
} from './types';

export interface ITransactionsManager {
  evm: IEvmTransactionsController;
  sys: ISysTransactionsController;
}

const TransactionsManager = (): ITransactionsManager => ({
  evm: EvmTransactionsController(),
  sys: SysTransactionController(),
});

export default TransactionsManager;
