import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '..';
import CheckIcon from 'assets/all_assets/check_icon.svg';
import {
  CenterPanel,
  CenterTitle,
  DialogPrimitive,
} from 'components/Dialog/Dialog';
import { ImWarning, MdBugReport } from 'components/Icon/Icon';

// Centered modal variants, rebuilt as declarative compositions over the
// Dialog primitive (components/Dialog). The legacy `Modal` wrapper is kept
// for call sites that compose their own panel.

interface IModal {
  children: ReactNode;
  className?: string;
  onClose?: () => any;
  show?: boolean;
}

interface IDefaultModal {
  buttonText?: string;
  children?: ReactNode;
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
  <DialogPrimitive
    presentation="center"
    className={className}
    onClose={onClose}
    show={show}
  >
    {children}
  </DialogPrimitive>
);

export const DefaultModal = ({
  buttonText = 'Ok',
  description = '',
  onClose,
  show,
  title = '',
}: IDefaultModal) => (
  <Modal show={show} onClose={onClose}>
    <CenterPanel>
      <CenterTitle>{title}</CenterTitle>

      <div className="mt-2">
        <p className="text-white text-sm">{description}</p>
      </div>

      <div className="flex items-center justify-center mt-4">
        <Button
          variant="neutral"
          className="text-sm text-brand-royalblue"
          type="button"
          onClick={onClose}
          id="got-it-btn"
        >
          {buttonText}
        </Button>
      </div>
    </CenterPanel>
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
    <CenterPanel>
      <CenterTitle>{title}</CenterTitle>

      <div className="mt-2">
        <p className="text-white text-sm">{description}</p>
      </div>

      {!!warningMessage && (
        <div className="mt-2">
          <p className="text-white text-xs disabled">{warningMessage}</p>
        </div>
      )}

      <div className="flex items-center justify-center mt-4">
        <Button
          variant="neutral"
          className="text-sm text-brand-royalblue"
          type="button"
          onClick={onClose}
          id="got-it-btn"
        >
          {buttonText}
        </Button>
      </div>
    </CenterPanel>
  </Modal>
);

export const ConfirmationModal = ({
  buttonText = 'Ok',
  children,
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
      <CenterPanel>
        <CenterTitle>{title}</CenterTitle>

        <div className="mt-2">
          <p className="text-white text-sm">{description}</p>
          {children}
        </div>

        <div className="flex items-center justify-center mt-4 gap-4">
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="button"
            onClick={onClose}
            id="cancel-btn"
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="button"
            onClick={onClick}
            id="confirm-btn"
            loading={isButtonLoading}
          >
            {buttonText}
          </Button>
        </div>
      </CenterPanel>
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
          <h3 className="text-brand-white text-base font-medium leading-6">
            {title.toUpperCase()}
          </h3>
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
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                window.open(
                  `mailto:support@syscoin.org?subject="Pali Error Report: Token creation"&body=${log}`
                )
              }
            >
              <MdBugReport size={20} />
              Report
            </Button>

            <Button variant="primary" type="button" onClick={onClose}>
              <img src={CheckIcon} alt="Check icon" />
              {buttonText}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
