import { Menu } from '@headlessui/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ExternalLinkSvg, TrashIconSvg } from 'components/Icon/Icon';
import { Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { RootState } from 'state/store';
import { UpdateTxAction } from 'utils/transactions';
import { ITransactionOptions } from 'utils/types';

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

export const TransactionOptions: React.FC<ITransactionOptions> = ({
  handleUpdateTransaction,
  transaction,
  alert,
  chainId,
  setIsOpenModal,
  setModalData,
}) => {
  const isLegacyTransaction =
    transaction.type === 0 || String(transaction.type) === '0x0';

  const { t } = useTranslation();
  const { navigate } = useUtils();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const handleOnClick = (actionType: UpdateTxAction) => {
    setIsOpenModal(true);

    switch (actionType) {
      case UpdateTxAction.Cancel:
        setModalData({
          buttonText: t('buttons.confirm'),
          title: t('header.cancelTx'),
          description: t('header.cancelTxMessage'),
          onClose: () => setIsOpenModal(false),
          onClick: () => {
            handleUpdateTransaction({
              updateData: {
                alert,
                chainId,
                isLegacy: isLegacyTransaction,
                txHash: transaction.hash,
                updateType: UpdateTxAction.Cancel,
                nonce: transaction.nonce,
              },
              t,
            });
            setIsOpenModal(false);
          },
        });
        break;
      case UpdateTxAction.SpeedUp:
        setModalData({
          buttonText: t('buttons.confirm'),
          title: t('header.speedTx'),
          description: t('header.speedTxMessage'),
          onClose: () => setIsOpenModal(false),
          onClick: () => {
            handleUpdateTransaction({
              updateData: {
                alert,
                chainId,
                isLegacy: isLegacyTransaction,
                txHash: transaction.hash,
                updateType: UpdateTxAction.SpeedUp,
              },
              t,
            });
            setIsOpenModal(false);
          },
        });
        break;
    }
  };

  const handleGoTxDetails = useCallback(() => {
    navigate('/home/details', {
      state: {
        id: null,
        hash: transaction.hash,
      },
    });
  }, [transaction.hash]);

  const openTransactionOnExplorer = useCallback(() => {
    const url = `${adjustedExplorer}tx/${transaction.hash}`;
    window.open(url, '_blank');
  }, [adjustedExplorer, transaction.hash]);

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
              className="inline-flex justify-center w-full 
          hover:text-button-primaryhover text-white text-sm font-medium 
          hover:bg-opacity-30 rounded-full w-5"
            >
              <EditTxIcon />
            </Menu.Button>

            <div className="absolute right-0 z-10 h-[15rem]">
              <Menu.Items
                as="div"
                className={`p-4 absolute right-0 z-10 w-[23rem] origin-top-right rounded-lg bg-brand-blue500 shadow-2xl ring-1 
                font-poppins ring-black ring-opacity-5 focus:outline-none transition-all duration-100 ease-out
                transform ${
                  open
                    ? 'opacity-100 scale-100 pointer-events-auto'
                    : 'opacity-0 scale-95 pointer-events-none'
                }`}
                static
              >
                <h1 className="text-sm font-semibold text-brand-gray200 pb-2 px-2">
                  {t('transactions.pendingTransaction')}
                </h1>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                    ${active ? 'bg-brand-blue400 bg-opacity-50' : ''}
                    flex items-center justify-start text-brand-white mb-2 w-full p-2 rounded-md
                    transition-all duration-150 cursor-pointer hover:bg-brand-blue400 hover:bg-opacity-30
                    `}
                      onClick={handleGoTxDetails}
                    >
                      <div className="w-5 mr-3">
                        <ExternalLinkIcon />
                      </div>
                      <span className="text-sm text-brand-white">
                        {t('transactions.seeDetails')}
                      </span>
                    </li>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                    ${active ? 'bg-brand-blue400 bg-opacity-50' : ''}
                    flex items-center justify-start text-brand-white mb-2 w-full p-2 rounded-md
                    transition-all duration-150 cursor-pointer hover:bg-brand-blue400 hover:bg-opacity-30
                    `}
                      onClick={openTransactionOnExplorer}
                    >
                      <div className="w-5 mr-3">
                        <ExternalLinkIcon />
                      </div>
                      <span className="text-sm text-brand-white">
                        {t('transactions.seeOnBlockExplorer')}
                      </span>
                    </li>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                    ${active ? 'bg-brand-blue400 bg-opacity-50' : ''}
                    flex items-center justify-start text-brand-white mb-2 w-full p-2 rounded-md
                    transition-all duration-150 cursor-pointer hover:bg-brand-blue400 hover:bg-opacity-30
                    `}
                      onClick={() => handleOnClick(UpdateTxAction.SpeedUp)}
                    >
                      <div className="w-5 mr-3">
                        <SpeedUpIcon />
                      </div>
                      <span className="text-sm text-brand-white">
                        {t('header.speedUp')}
                      </span>
                    </li>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                  ${active ? 'bg-brand-blue400 bg-opacity-50' : ''}
                  flex items-center justify-start text-brand-white w-full p-2 rounded-md
                  transition-all duration-150 cursor-pointer hover:bg-brand-blue400 hover:bg-opacity-30
                  `}
                      onClick={() => handleOnClick(UpdateTxAction.Cancel)}
                    >
                      <div className="w-5 mr-3">
                        <CancelIcon />
                      </div>
                      <span className="text-sm text-brand-white">
                        {t('buttons.cancel')}
                      </span>
                    </li>
                  )}
                </Menu.Item>
              </Menu.Items>
            </div>
          </>
        )}
      </Menu>
    </>
  );
};
