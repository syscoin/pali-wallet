import { Menu, Transition } from '@headlessui/react';
import React, { useCallback } from 'react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon, IconButton } from '..';
import { useUtils } from 'hooks/useUtils';
import { UpdateTxAction } from 'utils/transactions';
import { ITransactionOptions } from 'utils/types';

export const TransactionOptions: React.FC<ITransactionOptions> = ({
  handleUpdateTransaction,
  transaction,
  alert,
  chainId,
  wallet,
  setIsOpenModal,
  setModalData,
}) => {
  const isLegacyTransaction =
    transaction.type === 0 || String(transaction.type) === '0x0';

  const { t } = useTranslation();
  const { navigate } = useUtils();

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
                wallet,
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
                wallet,
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
  }, []);

  return (
    <>
      <Menu
        id="transaction-options"
        as="div"
        className="relative inline-block text-left"
      >
        <Menu.Button
          className="inline-flex justify-center w-full 
      hover:text-button-primaryhover text-white text-sm font-medium 
      hover:bg-opacity-30 rounded-full"
        >
          <IconButton className="w-5">
            <Icon isSvg name="EditTx" className="text-base" />
          </IconButton>
        </Menu.Button>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <div className="absolute right-0 z-10 h-[15rem]">
            <Menu.Items
              as="div"
              className="p-6 absolute right-0 z-10 w-[23rem] origin-top-right rounded-lg bg-brand-blue500 shadow-2xl ring-1 
            font-poppins ring-black ring-opacity-5 focus:outline-none transition-all duration-300 ease-in-out cursor-pointer"
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
                      <Icon
                        name="externalLink"
                        isSvg
                        className="text-base text-brand-white"
                      />
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
                      <Icon
                        name="SpeedUp"
                        isSvg
                        className="text-base text-brand-white"
                      />
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
                      <Icon
                        name="Trash"
                        isSvg
                        className="text-base text-brand-white"
                      />
                    </IconButton>
                    <span className="text-sm text-brand-white">
                      {t('buttons.cancel')}
                    </span>
                  </li>
                )}
              </Menu.Item>
            </Menu.Items>
          </div>
        </Transition>
      </Menu>
    </>
  );
};
