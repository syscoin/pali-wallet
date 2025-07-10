import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ImWarning } from 'react-icons/im';
import { MdBugReport } from 'react-icons/md';

import { PrimaryButton, SecondaryButton, NeutralButton } from '..';
import CheckIcon from 'assets/all_assets/check_icon.svg';

interface IModal {
  children: ReactNode;
  className?: string;
  onClose?: () => any;
  show?: boolean;
}

interface IDefaultModal {
  buttonText?: string;
  description?: string;
  isButtonLoading?: boolean;
  onClose?: () => any;
  show?: boolean;
  title: string;
}

interface IWarningModal extends IDefaultModal {
  warningMessage?: string;
}

interface IConfirmationModal extends IDefaultModal {
  onClick: () => void;
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
      className={`fixed z-[9999] inset-0 overflow-y-auto ${className}`}
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

      <div className="flex items-center justify-center mt-4">
        <NeutralButton type="button" onClick={onClose} id="got-it-btn">
          {buttonText}
        </NeutralButton>
      </div>
    </div>
  </Modal>
);

export const NewDefaultModal = ({
  buttonText = 'OK',
  description = '',
  onClose,
  show,
  title = '',
}: IDefaultModal) => (
  <Modal show={show} onClose={onClose}>
    <div
      className="inline-block absolute left-0 bottom-0 align-middle w-full max-w-md text-center font-poppins bg-bkg-blue200 shadow-xl overflow-hidden transform transition-all"
      style={{ borderRadius: '50px 50px 0px 0px', padding: '0px 0px 48px 0px' }}
    >
      <Dialog.Title
        as="h3"
        className="px-2.5 py-5 bg-bkg-blackAlpha uppercase text-brand-white text-base font-semibold leading-6"
      >
        {title}
      </Dialog.Title>

      <div className="flex items-center flex-col justify-center px-6 mt-7 gap-7">
        <p className="text-white text-sm">{description}</p>

        <NeutralButton
          type="button"
          onClick={onClose}
          id="got-it-btn"
          fullWidth={true}
          extraStyles="text-brand-blue text-base font-poppins"
        >
          {buttonText}
        </NeutralButton>
      </div>
    </div>
  </Modal>
);

export const WarningModal = ({
  buttonText = 'Ok',
  description = '',
  warningMessage = '',
  onClose,
  show,
  title = '',
}: IWarningModal) => (
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

      {!!warningMessage && (
        <div className="mt-2">
          <p className="text-white text-xs disabled">{warningMessage}</p>
        </div>
      )}

      <div className="flex items-center justify-center mt-4">
        <NeutralButton type="button" onClick={onClose} id="got-it-btn">
          {buttonText}
        </NeutralButton>
      </div>
    </div>
  </Modal>
);

export const ConfirmationModal = ({
  buttonText = 'Ok',
  description = '',
  onClose,
  onClick,
  show,
  title = '',
  isButtonLoading = false,
}: IConfirmationModal) => {
  const { t } = useTranslation();
  return (
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

        <div className="flex items-center justify-center mt-4 gap-4">
          <NeutralButton type="button" onClick={onClose} id="got-it-btn">
            {t('buttons.cancel')}
          </NeutralButton>
          <NeutralButton
            type="button"
            onClick={onClick}
            id="got-it-btn"
            loading={isButtonLoading}
          >
            {buttonText}
          </NeutralButton>
        </div>
      </div>
    </Modal>
  );
};

export const ErrorModal = ({
  buttonText = 'Ok',
  description = '',
  log,
  onClose,
  show,
  title = '',
}: IErrorModal) => {
  const { t } = useTranslation();

  return (
    <Modal show={show} onClose={onClose}>
      <div
        className="inline-block align-middle my-8 w-full text-center font-poppins bg-bkg-7 border rounded-2xl shadow-xl overflow-hidden transform transition-all"
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
              <ImWarning
                color="#DC1515"
                size={32}
                style={{ marginTop: '5px' }}
              />
            </div>

            <div>
              <span
                className="text-sm"
                style={{ color: '#FF1D1D', fontWeight: '600' }}
              >
                {t('buttons.errorDescription')}:{' '}
              </span>

              <span className="text-brand-white text-sm font-normal">
                {` ${log}`}
              </span>
            </div>
          </div>

          <div className="flex gap-x-1.5 items-center justify-between">
            <SecondaryButton
              type="button"
              onClick={() =>
                window.open(
                  `mailto:pali@pollum.io?subject="Pali Error Report: Token creation"&body=${log}`
                )
              }
            >
              <MdBugReport size={20} />
              Report
            </SecondaryButton>

            <PrimaryButton type="button" onClick={onClose}>
              <img src={CheckIcon} alt="Check icon" />
              {buttonText}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </Modal>
  );
};
