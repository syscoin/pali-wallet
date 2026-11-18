import { Menu } from '@headlessui/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { EVM_TRANSACTION_HISTORY_SOURCE } from '../../shared/evmHistory';
import { isTransactionInBlock } from '../../shared/transactionBlockStatus';
import { ExternalLinkSvg, TrashIconSvg } from 'components/Icon/Icon';
import { Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import { formatUnits } from 'utils/ethersV6Compat';
import { getWalletNavigationScope } from 'utils/navigationState';
import { buildExplorerUrl, selectExplorerUrl } from 'utils/strings';
import {
  previewCancelTransaction,
  previewSpeedUpTransaction,
  UpdateTxAction,
} from 'utils/transactions';
import { ITransactionOptions } from 'utils/types';

import { useSmartAccountCancellation } from './useSmartAccountCancellation';

// Memoize frequently used transaction option icons
const EditTxIcon = React.memo(() => (
  <Icon isSvg name="EditTx" className="text-base" />
));
EditTxIcon.displayName = 'EditTxIcon';

const ExternalLinkIcon = React.memo(() => (
  <ExternalLinkSvg className="text-base text-brand-white" />
));
ExternalLinkIcon.displayName = 'ExternalLinkIcon';

const SpeedUpIcon = React.memo(() => (
  <Icon name="SpeedUp" isSvg className="text-base text-brand-white" />
));
SpeedUpIcon.displayName = 'SpeedUpIcon';

const CancelIcon = React.memo(() => (
  <TrashIconSvg className="text-base text-brand-white" />
));
CancelIcon.displayName = 'CancelIcon';

const MENU_ITEM_CLASS_NAME =
  'flex items-center justify-start text-brand-white mb-2 w-full p-2 rounded-md transition-all duration-150 cursor-pointer hover:bg-brand-blue400 hover:bg-opacity-30';
const ACTIVE_ITEM_CLASS_NAME = 'bg-brand-blue400 bg-opacity-50';
const ITEM_TEXT_CLASS_NAME = 'text-sm text-brand-white';
const CANCEL_ITEM_CLASS_NAME = MENU_ITEM_CLASS_NAME.replace('mb-2 ', '');

const CancelTransactionMenuItem = ({
  busy,
  checkLive,
  hash,
  onClick,
  scope,
}: {
  busy: boolean;
  checkLive: boolean;
  hash: string;
  onClick: () => void;
  scope: ReturnType<typeof getWalletNavigationScope>;
}) => {
  const { t } = useTranslation();
  const [canCancel, setCanCancel] = useState(false);
  const { account, network } = scope;
  useEffect(() => {
    if (!checkLive) return;
    let current = true;
    void controllerEmitter(
      ['wallet', 'canCancelSavedSmartAccountTransaction'],
      [hash, { account, network }]
    ).then(
      (eligible) => {
        if (current) setCanCancel(eligible === true);
      },
      () => {
        if (current) setCanCancel(false);
      }
    );
    return () => {
      current = false;
    };
  }, [checkLive, hash, account, network]);
  if (checkLive && !canCancel) return null;
  return (
    <Menu.Item disabled={busy}>
      {({ active }) => (
        <li
          className={`${
            active ? ACTIVE_ITEM_CLASS_NAME : ''
          } ${CANCEL_ITEM_CLASS_NAME}`}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) onClick();
          }}
        >
          <div className="w-5 mr-3">
            <CancelIcon />
          </div>
          <span className={ITEM_TEXT_CLASS_NAME}>{t('buttons.cancel')}</span>
        </li>
      )}
    </Menu.Item>
  );
};

export const SmartAccountSignedOperationOptions = ({
  operationHash,
}: {
  operationHash: string;
}) => {
  const { t } = useTranslation();
  const cancellation = useSmartAccountCancellation(
    operationHash,
    operationHash
  );
  if (!cancellation.available) return null;
  return (
    <>
      <Menu as="div" className="relative inline-block text-left">
        <Menu.Button
          aria-label={t('transactions.transactionOptions')}
          className="inline-flex w-5 justify-center rounded-full text-white hover:text-button-primaryhover"
        >
          <EditTxIcon />
        </Menu.Button>
        <Menu.Items className="absolute right-0 z-10 w-max rounded-lg bg-brand-blue500 p-2 shadow-2xl ring-1 ring-black ring-opacity-5 focus:outline-none">
          <Menu.Item as={React.Fragment} disabled={cancellation.busy}>
            {({ active }) => (
              <button
                type="button"
                className={`${CANCEL_ITEM_CLASS_NAME} ${
                  active ? ACTIVE_ITEM_CLASS_NAME : ''
                }`}
                onClick={() => void cancellation.request()}
              >
                <span aria-hidden="true" className="mr-3 w-5">
                  <CancelIcon />
                </span>
                <span className={ITEM_TEXT_CLASS_NAME}>
                  {t('buttons.cancel')}
                </span>
              </button>
            )}
          </Menu.Item>
        </Menu.Items>
      </Menu>
      {cancellation.content}
    </>
  );
};

const TransactionOptionsBase: React.FC<ITransactionOptions> = ({
  handleUpdateTransaction,
  transaction,
  alert,
  chainId,
  setIsOpenModal,
  setModalData,
  canCancelSmart = false,
}) => {
  const isLegacyTransaction =
    transaction.type === 0 || String(transaction.type) === '0x0';

  const { t } = useTranslation();
  const { navigate } = useUtils();
  // Select only what we need to minimize re-renders
  const explorer = useSelector(selectExplorerUrl);
  const currency = useSelector(
    (state: RootState) => state.vault.activeNetwork.currency
  );
  const scope = useSelector(() => getWalletNavigationScope());
  const smartCancellation = useSmartAccountCancellation(transaction.hash);
  const signerAddress = smartCancellation.available
    ? transaction.feePayer ?? transaction.from
    : transaction.from;
  const local =
    'historySource' in transaction &&
    transaction.historySource === EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned;
  const mined = isTransactionInBlock(transaction);
  const speedUpAvailable =
    !mined &&
    (!local ||
      ('speedUpAvailable' in transaction &&
        transaction.speedUpAvailable === true));
  const cancellationUnavailable =
    (transaction as { cancellationUnavailable?: unknown })
      .cancellationUnavailable === true ||
    (smartCancellation.available && transaction.isCancel === true) ||
    (mined && !(canCancelSmart && smartCancellation.available)) ||
    (local && !(canCancelSmart && smartCancellation.available));
  const preview = useRef<{
    cancel: () => void;
    close: () => void;
  }>();

  useEffect(() => {
    preview.current?.close();
    return () => preview.current?.close();
  }, [
    scope.account,
    scope.network,
    transaction.hash,
    signerAddress,
    transaction.nonce,
    transaction.type,
    transaction.chainId,
    transaction.isReplaced,
    transaction.status,
    mined,
    chainId,
  ]);

  const previewReplacement = async (actionType: UpdateTxAction) => {
    const isCancel = actionType === UpdateTxAction.Cancel;
    preview.current?.cancel();
    const startingScope = getWalletNavigationScope();
    let cancelled = false;
    let confirmed = false;
    let maximumFee: string | undefined;
    const cancel = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    const close = () => {
      cancel();
      if (preview.current?.close !== close) return;
      preview.current = undefined;
      setIsOpenModal(false);
    };
    const current = () => {
      const latest = getWalletNavigationScope();
      return (
        !cancelled &&
        latest.account === startingScope.account &&
        latest.network === startingScope.network
      );
    };
    const confirm = () => {
      if (!current() || confirmed || maximumFee === undefined) return;
      confirmed = true;
      close();
      void handleUpdateTransaction({
        updateData: {
          alert,
          chainId,
          isLegacy: isLegacyTransaction,
          txHash: transaction.hash,
          updateType: actionType,
          nonce: transaction.nonce,
          signerAddress,
          approvedMaximumFee: maximumFee,
          walletScope: startingScope,
        },
        t,
      });
    };
    preview.current = { cancel, close };
    const modal = {
      buttonText: t('buttons.confirm'),
      title: t(isCancel ? 'header.cancelTx' : 'header.speedTx'),
      description: t(
        isCancel
          ? 'transactions.cancelFeePreview'
          : 'transactions.speedUpFeePreview'
      ),
      isButtonLoading: true,
      // This stage only reads a quote; cancelling it cannot cancel a send.
      allowCloseWhileLoading: true,
      onClose: close,
      onClick: confirm,
    };
    setModalData(modal);
    setIsOpenModal(true);
    const fail = () => {
      if (!current()) return;
      close();
      alert.error(
        t(
          isCancel
            ? 'transactions.cancelFeeUnavailable'
            : 'transactions.speedUpFeeUnavailable'
        )
      );
    };
    const timer = setTimeout(fail, 15_000);
    try {
      const fee = isCancel
        ? await previewCancelTransaction(
            transaction.hash,
            isLegacyTransaction,
            chainId,
            transaction.nonce,
            signerAddress,
            startingScope
          )
        : await previewSpeedUpTransaction(
            transaction.hash,
            isLegacyTransaction,
            chainId,
            signerAddress,
            startingScope
          );
      if (!current()) return;
      clearTimeout(timer);
      maximumFee = fee;
      setModalData({
        ...modal,
        description: t(
          isCancel
            ? 'transactions.cancelFeeConsent'
            : 'transactions.speedUpFeeConsent',
          {
            fee: formatUnits(fee, 18),
            currency: currency?.toUpperCase(),
          }
        ),
        isButtonLoading: false,
      });
    } catch (error: any) {
      if (error?.code === 'REPLACEMENT_VALUE_WOULD_CHANGE') {
        if (!current()) return;
        close();
        alert.error(t('transactions.speedUpAmountWouldChange'));
      } else if (error?.code === 'INSUFFICIENT_BALANCE') {
        if (!current()) return;
        close();
        alert.error(t('send.insufficientFunds'));
      } else {
        fail();
      }
    }
  };

  const handleOnClick = (actionType: UpdateTxAction) => {
    if (actionType === UpdateTxAction.Cancel) {
      if (cancellationUnavailable) return;
      if (smartCancellation.available) {
        void smartCancellation.request();
        return;
      }
    } else if (!speedUpAvailable) return;
    void previewReplacement(actionType);
  };

  const handleGoTxDetails = useCallback(() => {
    navigate('/home/details', {
      state: {
        id: null,
        hash: transaction.hash,
        tx: transaction,
      },
    });
  }, [transaction.hash]);

  const openTransactionOnExplorer = useCallback(() => {
    if (!explorer) return;
    const url = buildExplorerUrl(explorer, 'tx', transaction.hash);
    window.open(url, '_blank');
  }, [explorer, transaction.hash]);

  return (
    <>
      <Menu
        id="transaction-options"
        as="div"
        className="relative inline-block text-left"
      >
        {({ open }) => (
          <>
            <Menu.Button
              aria-label={t('transactions.transactionOptions')}
              className="inline-flex justify-center w-full
          hover:text-button-primaryhover text-white text-sm font-medium
          hover:bg-opacity-30 rounded-full w-5"
            >
              <EditTxIcon />
            </Menu.Button>

            <div className="absolute right-0 z-10 h-[15rem]">
              {open && (
                <Menu.Items
                  as="div"
                  className={`p-4 absolute right-0 z-10 w-[23rem] origin-top-right rounded-lg bg-brand-blue500 shadow-2xl ring-1
                  max-w-[calc(100vw-2rem)] font-poppins ring-black ring-opacity-5 focus:outline-none transition-all duration-100 ease-out transform opacity-100 scale-100 pointer-events-auto`}
                >
                  {!mined && (
                    <h1 className="text-sm font-semibold text-brand-gray200 pb-2 px-2">
                      {t('transactions.pendingTransaction')}
                    </h1>
                  )}
                  <Menu.Item>
                    {({ active }) => (
                      <li
                        className={`
                    ${active ? ACTIVE_ITEM_CLASS_NAME : ''}
                    ${MENU_ITEM_CLASS_NAME}
                    `}
                        onClick={handleGoTxDetails}
                      >
                        <div className="w-5 mr-3">
                          <ExternalLinkIcon />
                        </div>
                        <span className={ITEM_TEXT_CLASS_NAME}>
                          {t('transactions.seeDetails')}
                        </span>
                      </li>
                    )}
                  </Menu.Item>
                  {explorer && (
                    <Menu.Item>
                      {({ active }) => (
                        <li
                          className={`
                    ${active ? ACTIVE_ITEM_CLASS_NAME : ''}
                    ${MENU_ITEM_CLASS_NAME}
                    `}
                          onClick={openTransactionOnExplorer}
                        >
                          <div className="w-5 mr-3">
                            <ExternalLinkIcon />
                          </div>
                          <span className={ITEM_TEXT_CLASS_NAME}>
                            {t('transactions.seeOnBlockExplorer')}
                          </span>
                        </li>
                      )}
                    </Menu.Item>
                  )}
                  {speedUpAvailable && (
                    <Menu.Item>
                      {({ active }) => (
                        <li
                          className={`
                    ${active ? ACTIVE_ITEM_CLASS_NAME : ''}
                    ${MENU_ITEM_CLASS_NAME}
                    `}
                          onClick={() => handleOnClick(UpdateTxAction.SpeedUp)}
                        >
                          <div className="w-5 mr-3">
                            <SpeedUpIcon />
                          </div>
                          <span className={ITEM_TEXT_CLASS_NAME}>
                            {t('header.speedUp')}
                          </span>
                        </li>
                      )}
                    </Menu.Item>
                  )}
                  {!cancellationUnavailable && (
                    <CancelTransactionMenuItem
                      key={JSON.stringify([
                        transaction.hash,
                        scope.account,
                        scope.network,
                        mined,
                      ])}
                      busy={smartCancellation.busy}
                      checkLive={mined}
                      hash={transaction.hash}
                      onClick={() => handleOnClick(UpdateTxAction.Cancel)}
                      scope={scope}
                    />
                  )}
                </Menu.Items>
              )}
            </div>
          </>
        )}
      </Menu>
      {smartCancellation.content}
    </>
  );
};

export const TransactionOptions = React.memo(
  TransactionOptionsBase,
  (prev, next) => {
    const prevTx: any = prev.transaction as any;
    const nextTx: any = next.transaction as any;
    return (
      prev.chainId === next.chainId &&
      prev.canCancelSmart === next.canCancelSmart &&
      isTransactionInBlock(prevTx) === isTransactionInBlock(nextTx) &&
      prevTx?.isCancel === nextTx?.isCancel &&
      prev.alert === next.alert &&
      prevTx?.hash === nextTx?.hash &&
      prevTx?.from === nextTx?.from &&
      prevTx?.nonce === nextTx?.nonce &&
      prevTx?.type === nextTx?.type &&
      prevTx?.chainId === nextTx?.chainId &&
      prevTx?.isReplaced === nextTx?.isReplaced &&
      prevTx?.status === nextTx?.status &&
      prevTx?.historySource === nextTx?.historySource &&
      prevTx?.feePayer === nextTx?.feePayer &&
      prevTx?.speedUpAvailable === nextTx?.speedUpAvailable &&
      prevTx?.cancellationUnavailable === nextTx?.cancellationUnavailable &&
      prevTx?.isCanceled === nextTx?.isCanceled
    );
  }
);
