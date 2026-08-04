import React from 'react';
import { useTranslation } from 'react-i18next';

import { AddressText } from 'components/AddressText';
import { IDecodedTx } from 'types/transactions';

interface IErc20ApprovalAddressesProps {
  spender: string;
  tokenContract: string;
}

export const getErc20ApprovalAddressValues = (
  decodedTx: Pick<IDecodedTx, 'inputs'> | undefined,
  tokenContract: string
): IErc20ApprovalAddressesProps => ({
  spender: String(decodedTx?.inputs?.[0] || ''),
  tokenContract,
});

export const Erc20ApprovalAddresses: React.FC<IErc20ApprovalAddressesProps> = ({
  spender,
  tokenContract,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 p-3 w-full max-w-sm text-xs rounded-xl bg-bkg-2">
      <div className="flex items-center justify-between gap-3 w-full">
        <span className="text-brand-graylight">
          {t('transactions.spender')}
        </span>
        <AddressText
          className="text-brand-white"
          value={spender}
          preset="short"
        />
      </div>
      <div className="flex items-center justify-between gap-3 w-full">
        <span className="text-brand-graylight">
          {t('settings.contractAddress')}
        </span>
        <AddressText
          className="text-brand-white"
          value={tokenContract}
          preset="short"
        />
      </div>
    </div>
  );
};
