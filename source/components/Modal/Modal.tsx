import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, ReactNode } from 'react';

import { PrimaryButton, SecondaryButton, NeutralButton } from '..';

interface IModal {
  children: ReactNode;
  className?: string;
  onClose?: () => any;
  show?: boolean;
}

interface IDefaultModal {
  buttonText?: string;
  description?: string;
  onClose?: () => any;
  show?: boolean;
  title: string;
}

interface IErrorModal extends IDefaultModal {
  log: string;
}

export const Modal = ({
  children,
  className = '',
  onClose,
  show = true,
}: IModal) => (
  <Transition appear show={show} as={Fragment}>
    <Dialog
      as="div"
      className={`fixed z-10 inset-0 overflow-y-auto ${className}`}
      onClose={() => {
        if (onClose) onClose();
      }}
    >
      <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

      <div className="px-4 min-h-screen text-center">
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

        <span className="inline-block align-middle h-screen" aria-hidden="true">
          &#8203;
        </span>

        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          {children}
        </Transition.Child>
      </div>
    </Dialog>
  </Transition>
);

export const DefaultModal = ({
  buttonText = 'Ok',
  description = '',
  onClose,
  show,
  title = '',
}: IDefaultModal) => (
  <Modal show={show} onClose={onClose}>
    <div className="inline-block align-middle my-8 p-6 w-full max-w-md text-center font-poppins bg-bkg-4 rounded-2xl shadow-xl overflow-hidden transform transition-all">
      <Dialog.Title
        as="h3"
        className="pb-4 pt-2 text-brand-white text-lg font-medium leading-6 border-b border-dashed border-gray-600"
      >
        {title}
      </Dialog.Title>

      <div className="mt-2">
        <p className="text-white text-sm">{description}</p>
      </div>

      <div className="mt-4">
        <NeutralButton type="button" onClick={onClose} id="got-it-btn">
          {buttonText}
        </NeutralButton>
      </div>
    </div>
  </Modal>
);

export const ErrorModal = ({
  buttonText = 'Ok',
  description = '',
  log,
  onClose,
  show,
  title = '',
}: IErrorModal) => (
  <Modal className="max-w-2xl" show={show} onClose={onClose}>
    <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-3 border border-bkg-3 rounded-2xl shadow-xl overflow-hidden transform transition-all">
      <Dialog.Title
        as="h3"
        className="text-brand-white text-lg font-medium leading-6"
      >
        {title}
      </Dialog.Title>

      <div className="mt-4">
        <p className="text-gray-300 text-sm">{description}</p>
      </div>

      <p className="my-4 text-button-secondary text-sm">
        Error description: {` ${log}`}
      </p>

      <div className="flex gap-x-8 items-center justify-between mt-8">
        <PrimaryButton type="button" onClick={onClose}>
          {buttonText}
        </PrimaryButton>

        <SecondaryButton
          type="button"
          onClick={() =>
            window.open(
              `mailto:pali@pollum.io?subject="Pali Error Report: Token creation"&body=${log}`
            )
          }
        >
          Report
        </SecondaryButton>
      </div>
    </div>
  </Modal>
);
