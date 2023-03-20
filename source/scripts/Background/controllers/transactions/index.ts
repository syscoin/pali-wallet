import EvmTransactionsController from './evm';
import { IEvmTransactionsController } from './types';

export interface ITransactionsManager {
  evm: IEvmTransactionsController;
}

const TransactionsManager = (): ITransactionsManager => ({
  evm: EvmTransactionsController(),
});

export default TransactionsManager;
