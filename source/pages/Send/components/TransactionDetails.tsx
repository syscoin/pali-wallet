import { BigNumber } from '@ethersproject/bignumber';
import { formatEther, parseUnits } from '@ethersproject/units';
import { Input } from 'antd';
import React, { useEffect, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useController } from 'hooks/useController';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { IBlacklistCheckResult } from 'types/security';
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
  const { controllerEmitter } = useController();
  const [, copy] = useCopyClipboard();
  const [currentTxValue, setCurrentTxValue] = useState<string>('0');
  const [blacklistWarning, setBlacklistWarning] = useState<{
    isBlacklisted: boolean;
    reason?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }>({ isBlacklisted: false });
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

  // Calculate total fee: (gasLimit * maxFeePerGas) / 10^18 to get fee in native currency
  const gasLimit = customFee.isCustom ? customFee.gasLimit : fee.gasLimit;

  // Determine if this is a legacy transaction based on the original fee object
  const isLegacyTx = fee.gasPrice !== undefined;

  // Use the appropriate fee field based on transaction type
  const gasPriceGwei = customFee.isCustom
    ? isLegacyTx
      ? customFee.gasPrice
      : customFee.maxFeePerGas
    : isLegacyTx
    ? fee.gasPrice
    : fee.maxFeePerGas;

  // Convert from Gwei to Wei (multiply by 10^9) then calculate total fee
  // Show actual gas price, even if 0 (test networks now handle cancellation properly)
  const displayGasPrice = gasPriceGwei ?? 0;

  // Use BigNumber to prevent overflow when multiplying large numbers
  const gasLimitBN = BigNumber.from(gasLimit || 0);
  const gasPriceWeiBN = parseUnits(displayGasPrice.toString(), 'gwei');
  const totalFeeWeiBN = gasLimitBN.mul(gasPriceWeiBN);

  // Convert to ETH for display (safe as we're only using for display)
  const finalFee = Number(formatEther(totalFeeWeiBN));

  const formattedFinalFee = removeScientificNotation(finalFee);

  useEffect(() => {
    if (tx && tx.value) {
      // tx.value is in wei, store as string to preserve precision
      if (BigNumber.isBigNumber(tx.value)) {
        setCurrentTxValue(tx.value.toString());
      } else {
        setCurrentTxValue(String(tx.value));
      }
    }
  }, [tx]);

  // Check recipient address against blacklist
  useEffect(() => {
    const checkBlacklist = async () => {
      if (!tx?.to) return;

      try {
        const result = (await controllerEmitter(
          ['wallet', 'checkAddressBlacklist'],
          [tx.to]
        )) as IBlacklistCheckResult;
        if (result.isBlacklisted) {
          setBlacklistWarning({
            isBlacklisted: true,
            reason: result.reason,
            severity: result.severity,
          });
        } else {
          setBlacklistWarning({ isBlacklisted: false });
        }
      } catch (error) {
        console.error('Failed to check blacklist:', error);
      }
    };

    checkBlacklist();
  }, [tx?.to]);

  return (
    <div className="flex flex-col p-6 bg-brand-blue600 items-start justify-center w-full max-w-[400px] mx-auto text-left text-sm divide-alpha-whiteAlpha300 divide-dashed divide-y rounded-[20px]">
      <div className="flex flex-col pt-2 w-full text-xs text-brand-gray200 font-poppins font-normal">
        {t('send.from')}
        <div className="text-white text-xs">
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
        </div>
      </div>

      <div className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-normal">
        {t('send.to')}
        <div className="text-white text-xs">
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
        </div>
        {blacklistWarning.isBlacklisted && (
          <div
            className={`mt-2 p-2 rounded-md text-xs ${
              blacklistWarning.severity === 'critical'
                ? 'bg-red-900 text-red-100'
                : blacklistWarning.severity === 'high'
                ? 'bg-orange-900 text-orange-100'
                : 'bg-yellow-900 text-yellow-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon name="Warning" className="w-4 h-4" />
              <span className="font-semibold">
                {blacklistWarning.severity === 'critical'
                  ? t('blacklist.blacklistCriticalWarning')
                  : blacklistWarning.severity === 'high'
                  ? t('blacklist.blacklistHighRisk')
                  : t('blacklist.blacklistWarning')}
              </span>
            </div>
            <p className="mt-1">
              {blacklistWarning.reason ||
                t('blacklist.blacklistDefaultWarning')}
            </p>
            <p className="mt-1 font-semibold">
              {t('blacklist.blacklistWarningDiscouraged')}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-thin">
        {t('send.estimatedGasFee')}
        <div className="flex text-white text-xs">
          {formattedFinalFee} {activeNetwork.currency?.toUpperCase()}
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
        </div>
      </div>

      <div className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-thin">
        {t('send.customNonce')}
        <div className="text-white text-xs">
          <Input
            type="number"
            className="input-medium outline-0 w-10 bg-bkg-2 rounded-sm focus:outline-none focus-visible:outline-none"
            placeholder={String(tx.nonce)}
            defaultValue={tx.nonce}
            onChange={(e) => setCustomNonce(Number(e.target.value))}
          />
        </div>
      </div>

      <p className="flex flex-col pt-2 w-full text-brand-gray200 font-poppins font-thin">
        Total ({t('send.amountAndFee')})
        <span className="text-white text-xs">
          {removeScientificNotation(
            parseFloat(formatEther(currentTxValue)) + finalFee
          )}{' '}
          {activeNetwork.currency?.toUpperCase()}
        </span>
      </p>
    </div>
  );
};
