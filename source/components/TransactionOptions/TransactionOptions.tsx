import { Menu, Popover } from '@headlessui/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { EVM_TRANSACTION_HISTORY_SOURCE } from '../../shared/evmHistory';
import { ExternalLinkSvg, TrashIconSvg } from 'components/Icon/Icon';
import { Icon } from 'components/index';
import { useUtils } from 'hooks/index';
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

const DismissSpeedUpOnClose = ({ dismiss }: { dismiss: () => void }) => {
  useEffect(() => dismiss, [dismiss]);
  return null;
};

const SpeedUpReview = ({
  fee,
  confirm,
  back,
}: {
  back: () => void;
  confirm: () => void;
  fee?: string;
}) => {
  const { t } = useTranslation();
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => backButton.current?.focus(), []);
  const actionClass =
    'rounded-md px-2 py-1.5 text-xs text-white hover:bg-brand-blue400 disabled:opacity-50';

  return (
    <>
      {fee === undefined ? (
        <p role="status" className="text-xs text-brand-gray200 pb-2">
          {t('send.calculating')}
        </p>
      ) : (
        <dl className="pb-2 text-xs">
          <dt className="text-brand-gray200">
            {t('transactions.replay.maximumFee')}
          </dt>
          <dd className="break-words text-white">{fee}</dd>
        </dl>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          ref={backButton}
          onClick={back}
          className={actionClass}
        >
          {t('buttons.back')}
        </button>
        <button
          type="button"
          disabled={fee === undefined}
          onClick={confirm}
          className={`bg-brand-blue400 ${actionClass}`}
        >
          {t('buttons.confirm')}
        </button>
      </div>
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
  const speedUpAvailable =
    !local ||
    ('speedUpAvailable' in transaction &&
      transaction.speedUpAvailable === true);
  const cancellationUnavailable =
    (transaction as { cancellationUnavailable?: unknown })
      .cancellationUnavailable === true ||
    (smartCancellation.available && transaction.isCancel === true) ||
    (local && !(canCancelSmart && smartCancellation.available));
  const preview = useRef<{
    action: UpdateTxAction;
    cancel: () => void;
    close: () => void;
  }>();
  const [speedUpReview, setSpeedUpReview] = useState<{
    confirm: () => void;
    fee?: string;
  }>();
  const dismissSpeedUp = useCallback(() => {
    if (preview.current?.action === UpdateTxAction.SpeedUp)
      preview.current.close();
  }, []);

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
      if (isCancel) setIsOpenModal(false);
      else setSpeedUpReview(undefined);
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
    preview.current = { action: actionType, cancel, close };
    const showFee = (fee?: string) => {
      if (!isCancel) {
        setSpeedUpReview({ fee, confirm });
        return;
      }
      setModalData({
        buttonText: t('buttons.confirm'),
        title: t('header.cancelTx'),
        description:
          fee === undefined
            ? t('transactions.cancelFeePreview')
            : t('transactions.cancelFeeConsent', {
                fee,
                currency: currency?.toUpperCase(),
              }),
        isButtonLoading: fee === undefined,
        allowCloseWhileLoading: true,
        onClose: close,
        onClick: confirm,
      });
    };
    showFee();
    if (isCancel) setIsOpenModal(true);
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
      const formatted = formatUnits(fee, 18);
      showFee(
        isCancel || !currency
          ? formatted
          : `${formatted} ${currency.toUpperCase()}`
      );
    } catch (error: any) {
      if (error?.code === 'REPLACEMENT_VALUE_WOULD_CHANGE') {
        if (!current()) return;
        close();
        alert.error(t('transactions.speedUpAmountWouldChange'));
      } else {
        fail();
      }
    }
  };

  const handleOnClick = (actionType: UpdateTxAction) => {
    if (actionType === UpdateTxAction.Cancel && smartCancellation.available) {
      void smartCancellation.request();
      return;
    }
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
      <Popover
        id="transaction-options"
        as="div"
        className="relative inline-block text-left"
      >
        {({ open, close }) => (
          <>
            <Popover.Button
              className="inline-flex w-5 justify-center rounded-full text-white hover:text-button-primaryhover"
              aria-label={t('transactions.transactionOptions')}
            >
              <EditTxIcon />
            </Popover.Button>
            {open && (
              <Popover.Panel
                focus
                className="absolute right-0 z-10 w-56 max-w-[calc(100vw-2rem)] rounded-lg bg-brand-blue500 p-3 font-poppins shadow-2xl ring-1 ring-black ring-opacity-5"
              >
                <DismissSpeedUpOnClose dismiss={dismissSpeedUp} />
                <h2 className="pb-2 text-sm font-semibold text-brand-gray200">
                  {t(
                    speedUpReview
                      ? 'header.speedUp'
                      : 'transactions.pendingTransaction'
                  )}
                </h2>
                {speedUpReview ? (
                  <SpeedUpReview
                    {...speedUpReview}
                    back={() => {
                      dismissSpeedUp();
                      close();
                    }}
                    confirm={() => {
                      speedUpReview.confirm();
                      close();
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className={MENU_ITEM_CLASS_NAME}
                      onClick={() => {
                        close();
                        handleGoTxDetails();
                      }}
                    >
                      <span className="w-5 mr-3">
                        <ExternalLinkIcon />
                      </span>
                      <span className={ITEM_TEXT_CLASS_NAME}>
                        {t('transactions.seeDetails')}
                      </span>
                    </button>
                    {explorer && (
                      <button
                        type="button"
                        className={MENU_ITEM_CLASS_NAME}
                        onClick={() => {
                          close();
                          openTransactionOnExplorer();
                        }}
                      >
                        <span className="w-5 mr-3">
                          <ExternalLinkIcon />
                        </span>
                        <span className={ITEM_TEXT_CLASS_NAME}>
                          {t('transactions.seeOnBlockExplorer')}
                        </span>
                      </button>
                    )}
                    {speedUpAvailable && (
                      <button
                        type="button"
                        className={MENU_ITEM_CLASS_NAME}
                        onClick={() => handleOnClick(UpdateTxAction.SpeedUp)}
                      >
                        <span className="w-5 mr-3">
                          <SpeedUpIcon />
                        </span>
                        <span className={ITEM_TEXT_CLASS_NAME}>
                          {t('header.speedUp')}
                        </span>
                      </button>
                    )}
                    {!cancellationUnavailable && (
                      <button
                        type="button"
                        className={CANCEL_ITEM_CLASS_NAME}
                        disabled={smartCancellation.busy}
                        onClick={() => {
                          close();
                          handleOnClick(UpdateTxAction.Cancel);
                        }}
                      >
                        <span className="w-5 mr-3">
                          <CancelIcon />
                        </span>
                        <span className={ITEM_TEXT_CLASS_NAME}>
                          {t('buttons.cancel')}
                        </span>
                      </button>
                    )}
                  </>
                )}
              </Popover.Panel>
            )}
          </>
        )}
      </Popover>
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
