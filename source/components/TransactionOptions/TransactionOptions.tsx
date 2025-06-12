import { Menu } from '@headlessui/react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { ExternalLinkSvg, TrashIconSvg } from 'components/Icon/Icon';
import { Icon, IconButton } from 'components/index';
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
  const { activeNetwork } = useSelector((state: RootState) => state.vault);
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
              },
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
          hover:bg-opacity-30 rounded-full"
            >
              <IconButton className="w-5">
                <EditTxIcon />
              </IconButton>
            </Menu.Button>

            <div className="absolute right-0 z-10 h-[15rem]">
              <Menu.Items
                as="div"
                className={`p-6 absolute right-0 z-10 w-[23rem] origin-top-right rounded-lg bg-brand-blue500 shadow-2xl ring-1 
                font-poppins ring-black ring-opacity-5 focus:outline-none transition-all duration-100 ease-out cursor-pointer
                transform ${
                  open
                    ? 'opacity-100 scale-100 pointer-events-auto'
                    : 'opacity-0 scale-95 pointer-events-none'
                }`}
                static
              >
                <h1 className="text-sm font-semibold text-brand-gray200 pb-4">
                  PENDING TRANSACTION
                </h1>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                    ${active ? 'font-semibold' : 'font-normal'}
                    flex items-center justify-start text-brand-white mb-4 w-full
                    `}
                      onClick={handleGoTxDetails}
                    >
                      <IconButton className="w-5 mr-3">
                        <ExternalLinkIcon />
                      </IconButton>
                      <span className="text-sm text-brand-white">
                        See details
                      </span>
                    </li>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                    ${active ? 'font-semibold' : 'font-normal'}
                    flex items-center justify-start text-brand-white mb-4 w-full
                    `}
                      onClick={openTransactionOnExplorer}
                    >
                      <IconButton className="w-5 mr-3">
                        <ExternalLinkIcon />
                      </IconButton>
                      <span className="text-sm text-brand-white">
                        See on the block explorer
                      </span>
                    </li>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <li
                      className={`
                    ${active ? 'font-semibold' : 'font-normal'}
                    flex items-center justify-start text-brand-white mb-4 w-full
                    `}
                      onClick={() => handleOnClick(UpdateTxAction.SpeedUp)}
                    >
                      <IconButton className="w-5 mr-3">
                        <SpeedUpIcon />
                      </IconButton>
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
                  ${active ? 'font-semibold ' : 'font-normal'}
                  flex items-center justify-start w-full `}
                      onClick={() => handleOnClick(UpdateTxAction.Cancel)}
                    >
                      <IconButton className="w-5 mr-3">
                        <CancelIcon />
                      </IconButton>
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
