import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, useCallback, useMemo } from 'react';

interface IModal {
  description?: string;
  onClose?: () => any;
  show?: boolean;
  status: string;
  title: string;
}

export const StatusModal = ({
  description,
  onClose,
  show = true,
  title,
  status = '',
}: IModal) => {
  const theme = useMemo(() => {
    const themes = {
      error: {
        icon: 'assets/icons/error.svg',
        iconBg: 'bg-brand-redDark',
        bg: 'bg-brand-red',
      },
      success: {
        icon: 'assets/icons/whiteSuccess.svg',
        iconBg: 'bg-brand-darkGreen',
        bg: 'bg-brand-green',
      },
    };

    return themes[status] || {};
  }, [status]);

  const handleOnClose = useCallback(() => {
    if (onClose) onClose();
  }, []);

  return (
    <Transition appear show={show} as={Fragment}>
      <Dialog
        as="div"
        className={`fixed z-10 inset-0 overflow-y-auto  rounded-[20px]`}
        onClose={handleOnClose}
      >
        <div className="fixed z-0 -inset-0 w-full bg-transparent bg-opacity-50 transition-all duration-300 ease-in-out" />

        <div className="min-h-screen  text-center flex flex-col align-bottom justify-end items-center rounded-t-[50px]">
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
            <div
              className={`rounded-[20px] mb-12 flex flex-row align-bottom justify-end ${theme.iconBg} items-center shadow-md`}
            >
              <div className={`${theme.iconBg} p-4  h-full`}>
                <img className="w-[24px] h-[24px]" src={theme.icon} />
              </div>
              <div
                className={`flex flex-col w-[264px] rounded-r-[20px] p-4 ${theme.bg}`}
              >
                <div className="flex flex-row w-full justify-between">
                  <p className="text-white text-base font-medium ">{title}</p>
                  <img
                    src="../../assets/icons/close.svg"
                    className="w-[15px] h-[15px] hover:cursor-pointer"
                    onClick={handleOnClose}
                  />
                </div>
                <p className="text-white text-left text-sm font-normal">
                  {description}
                </p>
              </div>
            </div>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
};
