import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, ReactNode } from 'react';

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
      onClose={onClose ?? (() => {})}
    >
      <div
        onClick={() => console.log('inside onClick')}
        className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out"
      />

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
        <button
          type="button"
          className="inline-flex justify-center px-10 py-2 hover:text-bkg-4 text-brand-white text-sm font-medium hover:bg-button-popuphover bg-transparent border border-brand-white rounded-full focus:outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
          onClick={onClose}
          id="got-it-btn"
        >
          {buttonText}
        </button>
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
    <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-3 border border-red-500 rounded-2xl shadow-xl overflow-hidden transform transition-all">
      <Dialog.Title
        as="h3"
        className="text-brand-white text-lg font-medium leading-6"
      >
        {title}
      </Dialog.Title>

      <div className="mt-4">
        <p className="text-gray-300 text-sm">{description}</p>
      </div>

      <p className="my-4 text-red-500 text-sm">
        Error description:
        {log}
      </p>

      <div className="flex items-center justify-between mt-8">
        <button
          type="button"
          className="inline-flex justify-center px-12 py-2 text-red-500 text-sm font-medium bg-blue-100 border border-red-500 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
          onClick={onClose}
        >
          {buttonText}
        </button>

        <button
          type="button"
          className="inline-flex justify-center px-12 py-2 text-brand-white text-sm font-medium bg-red-500 hover:bg-opacity-70 border border-transparent rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
          onClick={() =>
            window.open(
              `mailto:pali@pollum.io?subject="Pali Error Report: Token creation"&body=${log}`
            )
          }
        >
          Report
        </button>
      </div>
    </div>
  </Modal>
);
