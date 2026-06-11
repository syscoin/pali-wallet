import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  DialogPrimitive,
  SheetHeader,
  SheetPanel,
} from 'components/Dialog/Dialog';
import { Button } from 'components/index';

// Bottom-sheet modal variants, rebuilt as declarative compositions over the
// Dialog primitive (components/Dialog). Unused legacy sheets were deleted;
// new flows should compose DialogPrimitive + SheetPanel directly.

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
  <DialogPrimitive presentation="sheet" onClose={onClose} show={show}>
    {children}
  </DialogPrimitive>
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
      <SheetPanel fullWidth={false}>
        <SheetHeader title={title} />
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
      </SheetPanel>
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
      <SheetPanel fullWidth={false}>
        <SheetHeader title={title} />
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%] gap-5">
          <p>{phraseOne}</p>
          <p>{phraseTwo}</p>
          <p>{phraseThree}</p>
        </div>
        <div className="flex gap-[21.10px]">
          <Button
            id="cancel-import-btn"
            type="button"
            className="bg-transparent w-[10.313rem] h-10 text-white text-base mb-12 font-base font-medium rounded-2xl border border-white"
            onClick={() => {
              if (onClose) onClose(false);
            }}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            id="confirm-import-btn"
            type="button"
            className="bg-white w-[10.313rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
            onClick={() => navigate('/import')}
          >
            {t('buttons.import')}
          </Button>
        </div>
      </SheetPanel>
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
      <SheetPanel>
        <SheetHeader title={title} />
        <div className="flex flex-col pt-6  px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseOne}</p>
        </div>
        <div className="flex flex-col  pb-7 px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseTwo}</p>
        </div>
        <Button
          id="account-created-ok-btn"
          type="button"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={() => navigate('/home')}
        >
          {t('buttons.ok')}
        </Button>
      </SheetPanel>
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
      <SheetPanel>
        <SheetHeader title={title} />
        <Button
          id="wallet-imported-ok-btn"
          type="button"
          className="bg-white w-[22rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
          onClick={() => navigate('/home')}
        >
          {t('buttons.ok')}
        </Button>
      </SheetPanel>
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
      'external.html?route=settings/account/hardware'
    );
    window.open(url, '_blank');

    // Set storage flag for detection
    chrome.storage.local.set(
      {
        'pali-popup-open': true,
        'pali-popup-timestamp': Date.now(),
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            '[WarningBaseModal] Failed to set popup flag:',
            chrome.runtime.lastError
          );
        }
      }
    );

    // Close the modal
    if (onClose) onClose(true);

    // Close the extension popup window after a short delay to ensure the new tab opens
    setTimeout(() => {
      window.close();
    }, 100);
  };

  return (
    <ModalBase onClose={onClose} show={show}>
      <SheetPanel>
        <SheetHeader title={title} />
        <div className="flex flex-col pt-6 pb-7 px-6 text-white text-left text-sm font-normal w-[94%]">
          <p>{phraseOne}</p>
        </div>

        <div className="flex gap-[21.10px]">
          <Button
            id="hardware-cancel-btn"
            type="button"
            className="bg-transparent w-[10.313rem] h-10 text-white text-base mb-12 font-base font-medium rounded-2xl border border-white"
            onClick={() => {
              if (onClose) onClose(true);
            }}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            id="hardware-connect-btn"
            type="button"
            className="bg-white w-[10.313rem] h-10 text-brand-blue200 text-base mb-12 font-base font-medium rounded-2xl"
            onClick={handleConnectHardwareWallet}
          >
            {t('buttons.connect')}
          </Button>
        </div>
      </SheetPanel>
    </ModalBase>
  );
};
