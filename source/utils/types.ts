import { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';
import { IMainController } from 'types/controllers';

import { UpdateTxAction } from './transactions';

// eslint-disable-next-line no-shadow
export enum NetworkType {
  EVM = 'EVM',
  UTXO = 'UTXO',
}

export interface ITransactionOptions {
  alert: any;
  chainId: number;
  handleUpdateTransaction: ({
    updateData,
  }: {
    updateData: {
      alert: any;
      chainId: number;
      isLegacy: boolean;
      txHash: string;
      updateType: UpdateTxAction;
      wallet: IMainController;
    };
  }) => Promise<void>;
  setIsOpenModal: React.Dispatch<React.SetStateAction<boolean>>;
  setModalData: React.Dispatch<
    React.SetStateAction<{
      buttonText: string;
      description: string;
      onClick: () => void;
      onClose: () => void;
      title: string;
    }>
  >;
  transaction: IEvmTransaction;
  wallet: IMainController;
}
