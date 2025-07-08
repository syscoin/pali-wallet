import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from 'components/index';
import {
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

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

export const ModalBase = ({ children, onClose, show }: IModal) => {
  if (!show) return null;

  return (
    <div className="fixed z-30 inset-0 overflow-y-auto animate-fadeIn">
      <div
        className="fixed inset-0 bg-brand-black bg-opacity-50 transition-opacity duration-300"
        onClick={() => {
          if (onClose) onClose();
        }}
      />
      <div className="fixed z-1 min-h-screen text-center flex flex-col align-bottom justify-end items-center rounded-t-[50px]">
        <div className="animate-slideIn">{children}</div>
      </div>
    </div>
  );
};

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

export const TokenSuccessfullyAdded = ({
  phraseOne,
  onClose,
  show = true,
  title,
  buttonText,
}: IDefaultModal) => (
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

export const TimeSetSuccessfully = ({
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

export const TxSuccessful = ({
  phraseOne,
  onClose,
  show = true,
  title,
}: IDefaultModal) => {
  const { t } = useTranslation();

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
          {t('buttons.ok')}
        </Button>
      </div>
    </ModalBase>
  );
};

export const ImportedWalletSuccessfully = ({
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

export const CreatedAccountSuccessfully = ({
  phraseOne,
  phraseTwo,
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
        <div className="flex flex-col pt-6  px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseOne}</p>
        </div>
        <div className="flex flex-col  pb-7 px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseTwo}</p>
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

export const RPCSuccessfullyAdded = ({
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
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseOne}</p>
        </div>

        <Button
          id="btn-ok"
          type="submit"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={() => {
            const returnContext = createNavigationContext('/home');
            navigateWithContext(
              navigate,
              '/settings/networks/edit',
              {},
              returnContext
            );
          }}
        >
          {t('buttons.ok')}
        </Button>
      </div>
    </ModalBase>
  );
};

export const ConnectHardwareWallet = ({
  phraseOne,
  onClose,
  show = true,
  title,
}: IDefaultModal) => {
  const { t } = useTranslation();

  const handleConnectHardwareWallet = () => {
    // Open hardware wallet setup in a new tab instead of popup window
    const url = chrome.runtime.getURL(
      'app.html?direct=true#/settings/account/hardware'
    );
    window.open(url, '_blank');

    // Close the modal
    if (onClose) onClose(true);

    // Close the extension popup window after a short delay to ensure the new tab opens
    setTimeout(() => {
      window.close();
    }, 100);
  };

  return (
    <ModalBase onClose={onClose} show={show}>
      <div className="rounded-t-[50px] w-screen flex flex-col align-bottom justify-end items-center bg-brand-blue400 shadow-md">
        <div className="bg-[#476daa] w-full py-5 rounded-t-[50px]">
          <h1 className="text-white font-medium text-base">{title}</h1>
        </div>
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseOne}</p>
        </div>

        <div className="flex gap-[21.10px]">
          <Button
            id="unlock-btn"
            type="submit"
            className="bg-transparent w-[10.313rem] h-10 text-white text-base mb-12 font-base font-medium rounded-2xl border border-white"
            onClick={() => {
              if (onClose) onClose(true);
            }}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            id="unlock-btn"
            type="submit"
            className="bg-white w-[10.313rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
            onClick={handleConnectHardwareWallet}
          >
            {t('buttons.connect')}
          </Button>
        </div>
      </div>
    </ModalBase>
  );
};
