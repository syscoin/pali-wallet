import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, ReactNode } from 'react';
import { ImWarning } from 'react-icons/im';

import CheckIcon from 'assets/icons/check_icon.png';
import ErrorIcon from 'assets/icons/error_icon.png';

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
    <div
      className="inline-block align-middle my-8 w-full max-w-2xl text-center font-poppins bg-bkg-7 border rounded-2xl shadow-xl overflow-hidden transform transition-all"
      style={{ borderColor: 'rgba(255,255,255, .15)' }}
    >
      <div
        className="py-6 border-b border-dashed"
        style={{ borderColor: 'rgba(255,255,255,.5)' }}
      >
        <Dialog.Title
          as="h3"
          className="text-brand-white text-base font-medium leading-6"
        >
          {title.toUpperCase()}
        </Dialog.Title>
      </div>

      <div className="pb-3 px-5 w-full">
        <div className="mt-5">
          <p className="text-brand-white text-sm">{description}</p>
        </div>

        <div
          className="flex mb-8 mt-5 p-3 text-left border border-dashed"
          style={{ borderColor: '#DC1515' }}
        >
          <div className="mr-4">
            <ImWarning color="#DC1515" size={32} style={{ marginTop: '5px' }} />
          </div>

          <div>
            <span
              className="text-sm"
              style={{ color: '#FF1D1D', fontWeight: '600' }}
            >
              Error description:{' '}
            </span>

            <span className="text-brand-white text-sm font-normal">
              {` ${log}`}
            </span>
          </div>
        </div>

        <div className="flex gap-x-1.5 items-center justify-between">
          <button
            type="button"
            className="max-w-40 inline-flex items-center justify-center px-3.5 py-2 w-40 text-brand-white text-base font-normal bg-bkg-pink200 hover:bg-opacity-70 border border-bkg-pink200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
            onClick={() =>
              window.open(
                `mailto:pali@pollum.io?subject="Pali Error Report: Token creation"&body=${log}`
              )
            }
          >
            <img src={ErrorIcon} className="mr-2.5" />
            Report
          </button>

          <button
            type="button"
            className="max-w-40 inline-flex items-center justify-center px-3.5 py-2 w-40 text-brand-white text-base font-normal bg-bkg-blue200 border border-bkg-blue200 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue focus-visible:ring-offset-2"
            onClick={onClose}
          >
            <img src={CheckIcon} className="mr-2.5" />
            {buttonText}
          </button>
        </div>
      </div>
    </div>
  </Modal>
);
