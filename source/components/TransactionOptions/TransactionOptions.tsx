import { Menu, Transition } from '@headlessui/react';
import React, { useState } from 'react';
import { Fragment } from 'react';

import { ConfirmationModal, Icon, IconButton } from '..';
import { IEvmTransaction } from 'scripts/Background/controllers/transactions/types';

interface ITransactionOptions {
  cancelTransaction: (hash: string, isLegacy: boolean) => Promise<void>;
  speedUpTransaction: (hash: string, isLegacy: boolean) => Promise<void>;
  transaction: IEvmTransaction;
}

export const TransactionOptions: React.FC<ITransactionOptions> = ({
  cancelTransaction,
  speedUpTransaction,
  transaction,
}) => {
  const [openConfirmCancelModal, setOpenConfirmCancelModal] =
    useState<boolean>(false);
  const [openConfirmSpeedUpModal, setOpenConfirmSpeedUpModal] =
    useState<boolean>(false);

  const isLegacyTransaction =
    transaction.type === 0 || String(transaction.type) === '0x0';

  function classNames(...classes) {
    return classes.filter(Boolean).join(' ');
  }

  return (
    <>
      <ConfirmationModal
        show={openConfirmCancelModal}
        buttonText="Confirm"
        title="Cancel Transaction"
        description="Are you sure that you want to cancel this transaction ?"
        onClose={() => setOpenConfirmCancelModal(false)}
        onClick={() => {
          cancelTransaction(transaction.hash, isLegacyTransaction);
          setOpenConfirmCancelModal(false);
        }}
      />

      <ConfirmationModal
        show={openConfirmSpeedUpModal}
        buttonText="Confirm"
        title="Speed Up Transaction"
        description="Are you sure that you want to speed up this transaction ?"
        onClose={() => setOpenConfirmSpeedUpModal(false)}
        onClick={() => {
          speedUpTransaction(transaction.hash, isLegacyTransaction);
          setOpenConfirmSpeedUpModal(false);
        }}
      />

      <Menu
        id="transaction-options"
        as="div"
        className="relative inline-block text-left"
      >
        <Menu.Button
          className="inline-flex justify-center w-full 
      hover:text-button-primaryhover text-white text-sm font-medium 
      hover:bg-opacity-30 rounded-full focus:outline-none 
      focus-visible:ring-2 focus-visible:ring-white 
      focus-visible:ring-opacity-75"
        >
          <IconButton className="w-5">
            <Icon name="dots" className="text-base" />
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
          <Menu.Items
            as="div"
            className="absolute right-0 z-10 w-44 origin-top-right rounded-md bg-menu-primary shadow-2xl ring-1 
            font-poppins ring-black ring-opacity-5 focus:outline-none transition-all duration-300 ease-in-out"
          >
            <Menu.Item>
              {({ active }) => (
                <li
                  className={classNames(
                    active ? 'bg-bkg-3 font-bold' : 'font-normal',
                    'flex items-center justify-start py-2 px-3 cursor-pointer'
                  )}
                  onClick={() => setOpenConfirmCancelModal(true)}
                >
                  <IconButton className="w-5 mr-3">
                    <Icon name="close" className="text-base text-brand-white" />
                  </IconButton>
                  <span className="text-sm text-brand-white">Cancel</span>
                </li>
              )}
            </Menu.Item>
            <Menu.Item>
              {({ active }) => (
                <li
                  className={classNames(
                    active ? 'bg-bkg-3 font-bold' : 'font-normal',
                    'flex items-center justify-start text-brand-white py-2 px-3 cursor-pointer'
                  )}
                  onClick={() => setOpenConfirmSpeedUpModal(true)}
                >
                  <IconButton className="w-5 mr-3">
                    <Icon name="rise" className="text-base text-brand-white" />
                  </IconButton>
                  <span className="text-sm text-brand-white">Speed Up</span>
                </li>
              )}
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    </>
  );
};
