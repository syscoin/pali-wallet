import { TransactionType } from '../types/transactions';
export {
  isTransactionInBlock,
  getTransactionBlockInfo,
} from '../shared/transactionBlockStatus.ts';

export const getDefaultGasLimit = (
  transactionType: TransactionType
): number => {
  switch (transactionType) {
    case TransactionType.NATIVE_ETH:
      return 42000;
    case TransactionType.ERC20:
      return 100000;
    case TransactionType.ERC721:
      return 150000;
    case TransactionType.ERC1155:
      return 200000;
    case TransactionType.UTXO:
      return 0; // UTXO doesn't use gas
    default:
      return 42000; // fallback to basic transfer
  }
};
