import {
  ExclamationIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from '@heroicons/react/outline';
import React, { ReactNode, RefObject, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import CheckIcon from 'assets/all_assets/check_icon.svg';
import {
  CenterPanel,
  DialogPrimitive,
  DialogActions,
  DialogActionButton,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from 'components/Dialog/Dialog';
import { MdBugReport } from 'components/Icon/Icon';

// Centered modal variants, rebuilt as declarative compositions over the
// Dialog primitive (components/Dialog). The legacy `Modal` wrapper is kept
// for call sites that compose their own panel.

interface IModal {
  children: ReactNode;
  className?: string;
  initialFocus?: RefObject<HTMLElement>;
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
  allowCloseWhileLoading?: boolean;
  onClick: () => void;
}

interface IErrorModal extends IDefaultModal {
  log: string;
}

export const Modal = ({
  children,
  className = '',
  initialFocus,
  onClose,
  show = true,
}: IModal) => (
  <DialogPrimitive
    presentation="center"
    className={className}
    initialFocus={initialFocus}
    onClose={onClose}
    show={show}
  >
    {children}
  </DialogPrimitive>
);

export const DefaultModal = ({
  buttonText,
  description = '',
  onClose,
  show,
  title = '',
}: IDefaultModal) => {
  const { t } = useTranslation();
  return (
    <Modal show={show} onClose={onClose}>
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          title={title}
          icon={<InformationCircleIcon />}
          onClose={onClose}
        />
        <DialogBody>
          <p>{description}</p>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton type="button" onClick={onClose} id="got-it-btn">
              {buttonText === undefined ? t('buttons.ok') : buttonText}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </Modal>
  );
};

export const WarningModal = ({
  buttonText,
  description = '',
  warningMessage = '',
  onClose,
  show,
  title = '',
}: IWarningModal) => {
  const { t } = useTranslation();
  return (
    <Modal show={show} onClose={onClose}>
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          title={title}
          icon={<ExclamationIcon />}
          onClose={onClose}
        />
        <DialogBody>
          <p>{description}</p>

          {!!warningMessage && (
            <div className="mt-2">
              <p className="text-white text-xs disabled">{warningMessage}</p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton type="button" onClick={onClose} id="got-it-btn">
              {buttonText === undefined ? t('buttons.ok') : buttonText}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </Modal>
  );
};

export const ConfirmationModal = ({
  buttonText,
  children,
  description = '',
  onClose,
  onClick,
  show,
  title = '',
  isButtonLoading = false,
  allowCloseWhileLoading = false,
}: IConfirmationModal) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const dismissalBlocked = isButtonLoading && !allowCloseWhileLoading;
  const close = () => {
    if (!dismissalBlocked) onClose?.();
  };
  return (
    <Modal show={show} onClose={close} initialFocus={panelRef}>
      <CenterPanel
        ref={panelRef}
        tabIndex={-1}
        aria-busy={isButtonLoading}
        padded={false}
        scroll={false}
        className="flex flex-col"
      >
        <DialogHeader
          title={title}
          icon={<ShieldCheckIcon />}
          onClose={close}
          disabled={dismissalBlocked}
        />
        <DialogBody>
          <p className="[overflow-wrap:anywhere]">{description}</p>
          {children}
        </DialogBody>

        <DialogFooter>
          <DialogActions>
            <DialogActionButton
              tone="secondary"
              type="button"
              onClick={close}
              disabled={dismissalBlocked}
              id="cancel-btn"
            >
              {t('buttons.cancel')}
            </DialogActionButton>
            <DialogActionButton
              type="button"
              onClick={() => {
                if (!isButtonLoading) onClick();
              }}
              id="confirm-btn"
              loading={isButtonLoading}
            >
              {buttonText === undefined ? t('buttons.ok') : buttonText}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </Modal>
  );
};

export const ErrorModal = ({
  buttonText,
  description = '',
  log,
  onClose,
  show,
  title = '',
}: IErrorModal) => {
  const { t } = useTranslation();

  return (
    <Modal show={show} onClose={onClose}>
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          title={title.toUpperCase()}
          icon={<XCircleIcon className="text-brand-red" />}
          onClose={onClose}
        />
        <DialogBody>
          <p>{description}</p>

          <div
            className="mt-4 p-3 text-left border border-dashed rounded-xl min-w-0 break-words [overflow-wrap:anywhere]"
            style={{ borderColor: '#DC1515' }}
          >
            <div>
              <span
                className="text-sm"
                style={{ color: '#ff8f8f', fontWeight: '600' }}
              >
                {t('buttons.errorDescription')}:{' '}
              </span>

              <span className="text-brand-white text-sm font-normal">
                {` ${log}`}
              </span>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton
              tone="secondary"
              type="button"
              onClick={() =>
                window.open(
                  `mailto:support@syscoin.org?subject="Pali Error Report: Token creation"&body=${log}`
                )
              }
            >
              <MdBugReport size={20} />
              {t('buttons.report')}
            </DialogActionButton>

            <DialogActionButton type="button" onClick={onClose}>
              <img src={CheckIcon} alt="" aria-hidden="true" />
              {buttonText === undefined ? t('buttons.ok') : buttonText}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </Modal>
  );
};
