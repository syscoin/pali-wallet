import type { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';

import { UpdateTxAction } from './transactions';

// eslint-disable-next-line no-shadow
export enum PaliLanguages {
  DE = 'de',
  EN = 'en',
  ES = 'es',
  FR = 'fr',
  JA = 'ja',
  KO = 'ko',
  PT = 'pt',
  RU = 'ru',
  ZH = 'zh',
}

export interface ITransactionOptions {
  alert: any;
  chainId: number;
  handleUpdateTransaction: ({
    updateData,
    t,
  }: {
    t: (key: string) => string;
    updateData: {
      alert: any;
      chainId: number;
      isLegacy: boolean;
      txHash: string;
      updateType: UpdateTxAction;
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
}
