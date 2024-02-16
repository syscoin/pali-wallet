import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';

interface IModal {
  description?: string;
  onClose?: () => any;
  show?: boolean;
  title: string;
}

export const WalletReadyModal = ({
  description,
  onClose,
  show = true,
  title,
}: IModal) => {
  const { t } = useTranslation();

  const handleOnClose = useCallback(() => {
    if (onClose) onClose();
  }, []);

  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog
        as="div"
        className={`fixed z-30 inset-0 overflow-y-auto rounded-t-[50px]`}
        onClose={handleOnClose}
      >
        <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

        <div className="min-h-screen text-center flex flex-col align-bottom justify-end items-center rounded-t-[50px]">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Dialog.Overlay className="fixed inset-0" />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <div className="rounded-t-[50px] flex flex-col align-bottom justify-end items-center bg-brand-blue rounded-lg shadow-md">
              <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
                <h1 className="text-white font-medium text-base">{title}</h1>
              </div>
              <p className="text-white text-left text-sm font-normal w-[94%] px-6 pt-6 pb-7">
                {description}
              </p>
              <Button
                id="unlock-btn"
                type="submit"
                className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
                onClick={handleOnClose}
              >
                {t('buttons.unlock')}
              </Button>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};
