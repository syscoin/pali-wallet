import { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';
import { IMainController } from 'types/controllers';

import { UpdateTxAction } from './transactions';

// eslint-disable-next-line no-shadow
export enum NetworkType {
  EVM = 'EVM',
  UTXO = 'UTXO',
}
// eslint-disable-next-line no-shadow
export enum PaliLanguages {
  EN = 'en',
  ES = 'es',
  PT = 'pt-br',
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
  isOpen?: boolean;
  onClose?: any;
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

export interface IEIP6963ProviderInfo {
  icon: string;
  name: string;
  rdns: string;
  uuid: string;
}
