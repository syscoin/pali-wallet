import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from 'components/index';

interface IModal {
  children?: ReactNode;
  onClose?: (value?: any) => any;
  show?: boolean;
}

interface IDefaultModal {
  buttonText?: string;
  onClose?: (value?: any) => any;
  phraseFive?: string;
  phraseFour?: string;
  phraseOne?: string;
  phraseThree?: string;
  phraseTwo?: string;
  show?: boolean;
  title: string;
}

export const ModalBase = ({ children, onClose, show }: IModal) => (
  <Transition appear show={show} as={Fragment}>
    <Dialog
      as="div"
      className={`fixed z-30 inset-0 overflow-y-auto rounded-t-[50px]`}
      onClose={() => {
        if (onClose) onClose();
      }}
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
          {children}
        </Transition.Child>
      </div>
    </Dialog>
  </Transition>
);

export const WalletReadyModal = ({
  phraseOne,
  onClose,
  show = true,
  title,
}: IDefaultModal) => {
  const { t } = useTranslation();

  return (
    <ModalBase onClose={onClose} show={show}>
      <div className="rounded-t-[50px] flex flex-col align-bottom justify-end items-center bg-brand-blue400 rounded-lg shadow-md">
        <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
          <h1 className="text-white font-medium text-base">{title}</h1>
        </div>
        <p className="text-white text-left text-sm font-normal w-[94%] px-6 pt-6 pb-7">
          {phraseOne}
        </p>
        <Button
          id="unlock-btn"
          type="submit"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={() => {
            if (onClose) onClose(false);
          }}
        >
          {t('buttons.unlock')}
        </Button>
      </div>
    </ModalBase>
  );
};

export const ImportWalletWarning = ({
  phraseOne,
  phraseTwo,
  phraseThree,
  onClose,
  show = true,
  title,
}: IDefaultModal) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <ModalBase onClose={onClose} show={show}>
      <div className="rounded-t-[50px] flex flex-col align-bottom justify-end items-center bg-brand-blue400 rounded-lg shadow-md">
        <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
          <h1 className="text-white font-medium text-base">{title}</h1>
        </div>
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%] gap-5">
          <p>{phraseOne}</p>
          <p>{phraseTwo}</p>
          <p>{phraseThree}</p>
        </div>
        <div className="flex gap-[21.10px]">
          <Button
            id="unlock-btn"
            type="submit"
            className="bg-transparent w-[10.313rem] h-10 text-white text-base mb-12 font-base font-medium rounded-2xl border border-white"
            onClick={() => {
              if (onClose) onClose(false);
            }}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            id="unlock-btn"
            type="submit"
            className="bg-white w-[10.313rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
            onClick={() => navigate('/import')}
          >
            {t('buttons.import')}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};

export const TokenSuccessfulyAdded = ({
  phraseOne,
  onClose,
  show = true,
  title,
  buttonText,
}: IDefaultModal) => {
  const navigate = useNavigate();

  return (
    <ModalBase onClose={onClose} show={show}>
      <div className="rounded-t-[50px] w-screen flex flex-col align-bottom justify-end items-center bg-brand-blue400 shadow-md">
        <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
          <h1 className="text-white font-medium text-base">{title}</h1>
        </div>
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%] gap-5">
          <p>{phraseOne}</p>
        </div>
        <Button
          id="unlock-btn"
          type="submit"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={onClose}
        >
          {buttonText}
        </Button>
      </div>
    </ModalBase>
  );
};

export const TimeSetSuccessfuly = ({
  phraseOne,
  onClose,
  show = true,
  title,
}: IDefaultModal) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <ModalBase onClose={onClose} show={show}>
      <div className="rounded-t-[50px] w-screen flex flex-col align-bottom justify-end items-center bg-brand-blue400 shadow-md">
        <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
          <h1 className="text-white font-medium text-base">{title}</h1>
        </div>
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%] gap-5">
          <p>{phraseOne}</p>
        </div>
        <Button
          id="unlock-btn"
          type="submit"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={() => navigate('/home')}
        >
          {t('buttons.ok')}
        </Button>
      </div>
    </ModalBase>
  );
};

export const SignatureRequestSuccessfullySubmit = ({
  phraseOne,
  onClose,
  show = true,
  title,
}: IDefaultModal) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <ModalBase onClose={onClose} show={show}>
      <div className="rounded-t-[50px] w-screen flex flex-col align-bottom justify-end items-center bg-brand-blue400 shadow-md">
        <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
          <h1 className="text-white font-medium text-base">{title}</h1>
        </div>
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%] gap-5">
          <p>{phraseOne}</p>
        </div>
        <Button
          id="unlock-btn"
          type="submit"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={() => navigate('/home')}
        >
          {t('buttons.ok')}
        </Button>
      </div>
    </ModalBase>
  );
};
