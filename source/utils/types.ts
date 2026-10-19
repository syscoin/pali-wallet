import type { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';

import type { handleUpdateTransaction } from './transactions';

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
  handleUpdateTransaction: typeof handleUpdateTransaction;
  isOpen?: boolean;
  onClose?: any;
  setIsOpenModal: React.Dispatch<React.SetStateAction<boolean>>;
  setModalData: React.Dispatch<
    React.SetStateAction<{
      buttonText: string;
      description: string;
      isButtonLoading?: boolean;
      onClick: () => void;
      onClose: () => void;
      title: string;
    }>
  >;
  transaction: IEvmTransaction;
}
