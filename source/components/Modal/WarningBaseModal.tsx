import {
  CheckCircleIcon,
  DesktopComputerIcon,
  ExclamationIcon,
} from '@heroicons/react/outline';
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  DialogPrimitive,
  DialogActions,
  DialogActionButton,
  DialogHeader,
  DialogBody,
  DialogFooter,
  SheetPanel,
} from 'components/Dialog/Dialog';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';

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
        <DialogHeader
          title={title}
          icon={<CheckCircleIcon />}
          onClose={onClose}
        />
        <DialogBody>
          <p>{phraseOne}</p>
        </DialogBody>
        <DialogFooter className="w-full">
          <DialogActions>
            <DialogActionButton
              id="unlock-btn"
              type="button"
              onClick={() => {
                if (onClose) onClose(false);
              }}
            >
              {t('buttons.unlock')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
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
  const { alert } = useUtils();
  const { controllerEmitter } = useController();
  const { beginRecovery } = useOnboardingSecrets();
  const [isBeginning, setIsBeginning] = useState(false);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const discard = () => {
      requestGeneration.current += 1;
      if (mounted.current) setIsBeginning(false);
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') discard();
    };
    window.addEventListener('pagehide', discard);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
      window.removeEventListener('pagehide', discard);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!show) {
      requestGeneration.current += 1;
      setIsBeginning(false);
    }
  }, [show]);
  const close = () => {
    requestGeneration.current += 1;
    setIsBeginning(false);
    if (onClose) onClose(false);
  };
  const begin = async () => {
    if (isBeginning) return;
    const generation = ++requestGeneration.current;
    setIsBeginning(true);
    try {
      const ticket = await controllerEmitter(
        ['wallet', 'beginWalletRecovery'],
        []
      );
      if (!mounted.current || generation !== requestGeneration.current) return;
      beginRecovery(ticket as string);
      navigate('/import');
    } catch {
      if (mounted.current && generation === requestGeneration.current) {
        alert.error(t('settings.walletRecoveryFailed'));
      }
    } finally {
      if (mounted.current && generation === requestGeneration.current)
        setIsBeginning(false);
    }
  };

  return (
    <ModalBase onClose={close} show={show}>
      <SheetPanel fullWidth={false}>
        <DialogHeader
          title={title}
          icon={<ExclamationIcon />}
          onClose={close}
        />
        <DialogBody className="w-full space-y-4">
          <p>{phraseOne}</p>
          <p>{phraseTwo}</p>
          <p>{phraseThree}</p>
        </DialogBody>
        <DialogFooter className="w-full">
          <DialogActions>
            <DialogActionButton
              id="cancel-import-btn"
              type="button"
              tone="secondary"
              onClick={close}
            >
              {t('buttons.cancel')}
            </DialogActionButton>
            <DialogActionButton
              id="confirm-import-btn"
              type="button"
              disabled={isBeginning}
              loading={isBeginning}
              onClick={begin}
            >
              {t('buttons.recoverWallet')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
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
        <DialogHeader
          title={title}
          icon={<CheckCircleIcon />}
          onClose={onClose}
        />
        <DialogBody className="w-full space-y-4">
          <p>{phraseOne}</p>
          <p>{phraseTwo}</p>
        </DialogBody>
        <DialogFooter className="w-full">
          <DialogActions>
            <DialogActionButton
              id="account-created-ok-btn"
              type="button"
              onClick={() => {
                if (onClose) onClose();
                else navigate('/home');
              }}
            >
              {t('buttons.ok')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
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
        <DialogHeader
          title={title}
          icon={<CheckCircleIcon />}
          onClose={onClose}
        />
        <DialogFooter className="w-full">
          <DialogActions>
            <DialogActionButton
              id="wallet-imported-ok-btn"
              type="button"
              onClick={() => navigate('/home')}
            >
              {t('buttons.ok')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
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
  const { controllerEmitter } = useController();
  const { alert } = useUtils();

  const handleConnectHardwareWallet = async () => {
    try {
      await controllerEmitter(['createHardwareWalletTab'], [], 10000, false);
      if (onClose) onClose(true);
      window.close();
    } catch (error) {
      console.error('[WarningBaseModal] Failed to open hardware setup:', error);
      alert.error(t('send.sendError'));
    }
  };

  return (
    <ModalBase onClose={onClose} show={show}>
      <SheetPanel>
        <DialogHeader
          title={title}
          icon={<DesktopComputerIcon />}
          onClose={onClose}
        />
        <DialogBody className="w-full">
          <p>{phraseOne}</p>
        </DialogBody>

        <DialogFooter className="w-full">
          <DialogActions>
            <DialogActionButton
              id="hardware-cancel-btn"
              type="button"
              tone="secondary"
              onClick={() => {
                if (onClose) onClose(true);
              }}
            >
              {t('buttons.cancel')}
            </DialogActionButton>
            <DialogActionButton
              id="hardware-connect-btn"
              type="button"
              onClick={handleConnectHardwareWallet}
            >
              {t('buttons.connect')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </SheetPanel>
    </ModalBase>
  );
};
