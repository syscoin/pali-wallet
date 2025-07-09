import { Input } from 'antd';
import isNaN from 'lodash/isNaN';
import React, { useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import {
  ICustomFeeParams,
  IDecodedTx,
  IFeeState,
  ITxState,
} from 'types/transactions';
import { ellipsis } from 'utils/format';
import removeScientificNotation from 'utils/removeScientificNotation';

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="Copy"
    isSvg
    className="px-2 text-brand-white hover:text-fields-input-borderfocus"
  />
));
CopyIcon.displayName = 'CopyIcon';

interface ITransactionDetailsProps {
  customFee: ICustomFeeParams;
  decodedTx: IDecodedTx;
  fee: IFeeState;
  setCustomFee: React.Dispatch<React.SetStateAction<ICustomFeeParams>>;
  setCustomNonce: React.Dispatch<React.SetStateAction<number>>;
  setFee: React.Dispatch<React.SetStateAction<IFeeState>>;
  setHaveError: React.Dispatch<React.SetStateAction<boolean>>;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  tx: ITxState;
}

export const TransactionDetailsComponent = (
  props: ITransactionDetailsProps
) => {
  const { tx, setCustomNonce, fee, customFee, setIsOpen } = props;
  const { alert, useCopyClipboard } = useUtils();
  const [, copy] = useCopyClipboard();
  const [currentTxValue, setCurrentTxValue] = useState<number>(0);
  const { t } = useTranslation();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  // Helper function to get appropriate copy message based on field type
  const getCopyMessage = (fieldType: 'address' | 'hash' | 'other') => {
    switch (fieldType) {
      case 'address':
        return t('home.addressCopied');
      case 'hash':
        return t('home.hashCopied');
      default:
        return t('settings.successfullyCopied');
    }
  };

  const handleCopyWithMessage = (
    value: string,
    fieldType: 'address' | 'hash' | 'other' = 'address'
  ) => {
    copy(value);

    alert.info(getCopyMessage(fieldType));
  };

  const finalFee =
    +removeScientificNotation(
      customFee.isCustom ? customFee.maxFeePerGas : fee.maxFeePerGas
    ) /
    10 ** 9;

  const formattedFinalFee = removeScientificNotation(finalFee);

  useEffect(() => {
    if (tx && tx.value && !isNaN(Number(tx.value))) {
      setCurrentTxValue(tx.value);
    }
  }, [tx]);

  return (
    <div className="flex flex-col p-6 bg-brand-blue600 items-start justify-center w-[400px] relative left-[-1%] text-left text-sm divide-alpha-whiteAlpha300 divide-dashed divide-y rounded-[20px]">
      <p className="flex flex-col pt-2 w-full text-xs text-brand-gray200 font-poppins font-normal">
        {t('send.from')}
        <p className="text-white text-xs">
          <Tooltip content={tx.from} childrenClassName="flex">
            {ellipsis(tx.from, 7, 15)}
            {
              <IconButton
                onClick={() => handleCopyWithMessage(tx.from ?? '', 'address')}
              >
                <CopyIcon />
              </IconButton>
            }
          </Tooltip>
        </p>
      </p>

      <p className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-normal">
        {t('send.to')}
        <p className="text-white text-xs">
          <Tooltip content={tx.to} childrenClassName="flex">
            {ellipsis(tx.to, 7, 15)}
            {
              <IconButton
                onClick={() => handleCopyWithMessage(tx.to ?? '', 'address')}
              >
                <CopyIcon />
              </IconButton>
            }
          </Tooltip>
        </p>
      </p>

      <p className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-thin">
        {t('send.estimatedGasFee')}
        <p className="flex text-white text-xs">
          {formattedFinalFee} {activeNetwork.currency.toUpperCase()}
          <div
            className="hover:text-fields-input-borderfocus"
            onClick={() => setIsOpen(true)}
          >
            <Icon
              name="EditTx"
              isSvg
              className="px-2 text-brand-white hover:text-fields-input-borderfocus"
            />{' '}
          </div>
        </p>
      </p>

      <p className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-thin">
        {t('send.customNonce')}
        <p className="text-white text-xs">
          <Input
            type="number"
            className="input-medium outline-0 w-10 bg-bkg-2 rounded-sm focus:outline-none focus-visible:outline-none"
            placeholder={String(tx.nonce)}
            defaultValue={tx.nonce}
            onChange={(e) => setCustomNonce(Number(e.target.value))}
          />
        </p>
      </p>

      <p className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-thin">
        Total ({t('send.amountAndFee')})
        <span className="text-white text-xs">
          {removeScientificNotation(
            Number(currentTxValue) / 10 ** 18 + finalFee
          )}{' '}
          {activeNetwork.currency.toUpperCase()}
        </span>
      </p>
    </div>
  );
};
