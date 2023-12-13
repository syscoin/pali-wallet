import uniqueId from 'lodash/uniqueId';
import React, { Fragment, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { ConfirmationModal } from 'components/Modal';
import { TransactionOptions } from 'components/TransactionOptions';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis, formatDate, handleUpdateTransaction } from 'utils/index';

export const TransactionsList = ({
  userTransactions,
}: {
  userTransactions: any[]; //todo: adjust type
}) => {
  const { wallet } = getController();
  const { t } = useTranslation();
  const {
    activeNetwork: { chainId },
    isBitcoinBased,
    activeAccount,
    accounts,
  } = useSelector((state: RootState) => state.vault);

  const [modalData, setModalData] = useState<{
    buttonText: string;
    description: string;
    onClick: () => void;
    onClose: () => void;
    title: string;
  }>();
  const [isOpenModal, setIsOpenModal] = useState<boolean>(false);

  const currentAccount = accounts[activeAccount.type][activeAccount.id];

  const { navigate, alert } = useUtils();

  const getTxType = (tx: any, isTxSent: boolean) => {
    if (isBitcoinBased) {
      if (tx.tokenType === 'SPTAssetActivate') {
        return 'SPT creation';
      }

      if (tx.tokenType === 'SPTAssetSend') {
        return 'SPT mint';
      }

      if (tx.tokenType === 'SPTAssetUpdate') {
        return 'SPT update';
      }

      return 'Transaction';
    }

    const txLabel = isTxSent ? 'Sent' : 'Received';

    return `${txLabel}`;
  };

  const txid = isBitcoinBased ? 'txid' : 'hash';
  const blocktime = isBitcoinBased ? 'blockTime' : 'timestamp';

  const isShowedGroupBar = useCallback(
    (tx: any, idx: number) =>
      tx === null &&
      tx === undefined &&
      userTransactions[idx - 1] === undefined &&
      userTransactions[idx - 1] === null &&
      (idx === 0 ||
        new Date(tx[blocktime] * 1e3).toDateString() !==
          new Date(userTransactions[idx - 1][blocktime] * 1e3).toDateString()),
    [userTransactions]
  );

  const filteredTransactions = useMemo(() => {
    if (!Array.isArray(userTransactions)) {
      return [];
    }

    return userTransactions
      .filter((item: any) => {
        if (!isBitcoinBased) {
          return item?.chainId === chainId;
        }
        return item !== undefined && item !== null;
      })
      .sort((a: any, b: any) => {
        if (a[blocktime] > b[blocktime]) {
          return -1;
        }
        if (a[blocktime] < b[blocktime]) {
          return 1;
        }
        return 0;
      });
  }, [userTransactions, isBitcoinBased, chainId, blocktime]);

  const getTxStatus = useCallback(
    (isCanceled: boolean, isConfirmed: boolean) => {
      let className = '';
      let status = '';

      switch (isCanceled) {
        case true:
          className = 'text-warning-error';
          status = t('send.canceled');
          break;
        case false:
          className = isConfirmed ? 'text-warning-success' : 'text-yellow-300';
          status = isConfirmed ? t('send.confirmed') : t('send.pending');
          break;
      }

      return <p className={className}>{status}</p>;
    },
    [userTransactions]
  );

  const getTxOptions = (isCanceled: boolean, isConfirmed: boolean, tx: any) => {
    if (!isCanceled && !isConfirmed) {
      return (
        <TransactionOptions
          handleUpdateTransaction={handleUpdateTransaction}
          alert={alert}
          chainId={chainId}
          wallet={wallet}
          transaction={tx}
          isOpen={true}
          setIsOpenModal={setIsOpenModal}
          setModalData={setModalData}
        />
      );
    }
  };

  const renderTransaction = (tx, idx) => {
    const isTxCanceled = tx?.isCanceled === true;
    const isConfirmed = tx.confirmations > 0;
    const timestamp =
      blocktime &&
      new Date(tx[blocktime] * 1000).toLocaleTimeString(
        //todo: add day/month/year as well
        navigator.language,
        {
          hour: '2-digit',
          minute: '2-digit',
        }
      );

    const isTxSent = isBitcoinBased
      ? false
      : tx.from.toLowerCase() === currentAccount.address;

    return (
      tx[blocktime] && (
        <Fragment key={uniqueId(tx[txid])}>
          {isShowedGroupBar(tx, idx) && (
            <li className="my-3 text-center text-sm bg-bkg-1">
              {formatDate(new Date(tx[blocktime] * 1000).toDateString())}
            </li>
          )}

          <li className="py-2 border-b border-dashed border-dashed-dark">
            <div className="relative flex items-center justify-between text-xs">
              <div className="flex items-center">
                {!isBitcoinBased && (
                  <Icon
                    name={isTxSent ? 'arrow-up' : 'arrow-down'}
                    className="mx-2"
                  />
                )}
                <div className="flex flex-row">
                  <div>
                    <p>{ellipsis(tx[txid], 4, 14)}</p>

                    {getTxStatus(isTxCanceled, isConfirmed)}
                  </div>
                </div>
              </div>

              <div
                className={`absolute flex ${
                  isBitcoinBased ? 'right-20 w-20' : 'right-28 w-14'
                }`}
              >
                <div className="max-w-max text-left whitespace-nowrap overflow-hidden overflow-ellipsis">
                  <p className="text-blue-300">{timestamp}</p>

                  <p>{getTxType(tx, isTxSent)}</p>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <IconButton
                  className="w-5"
                  onClick={() =>
                    navigate('/home/details', {
                      state: {
                        id: null,
                        hash: tx[txid],
                      },
                    })
                  }
                >
                  <Icon name="select" className="text-base" />
                </IconButton>

                {!isBitcoinBased && getTxOptions(isTxCanceled, isConfirmed, tx)}
              </div>
            </div>
          </li>
        </Fragment>
      )
    );
  };

  const TransactionList = () => (
    <ul className="pb-4">
      {filteredTransactions.map((tx: any, idx: number) =>
        renderTransaction(tx, idx)
      )}
    </ul>
  );

  return (
    <>
      <ConfirmationModal show={isOpenModal} {...modalData} />
      <TransactionList />
    </>
  );
};
