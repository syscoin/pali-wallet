import { ExclamationIcon } from '@heroicons/react/outline';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  CenterPanel,
  DialogPrimitive,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogActions,
  DialogActionButton,
} from 'components/Dialog';

interface IValidationModalProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

export const ValidationModal = (props: IValidationModalProps) => {
  const { showModal, setIsOpen } = props;
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <DialogPrimitive
      show={showModal}
      onClose={() => {
        setIsOpen(false);
      }}
    >
      <CenterPanel padded={false} scroll={false} className="flex flex-col">
        <DialogHeader
          title={t('settings.forgetWarning')}
          icon={<ExclamationIcon />}
          onClose={() => setIsOpen(false)}
        />
        <DialogBody className="space-y-4">
          <p>{t('start.paliDoesnt')}</p>
          <p>{t('start.ifYouPlan')}</p>
        </DialogBody>
        <DialogFooter>
          <DialogActions>
            <DialogActionButton
              tone="secondary"
              type="button"
              onClick={() => setIsOpen(false)}
            >
              {t('buttons.cancel')}
            </DialogActionButton>

            <DialogActionButton
              type="button"
              onClick={() => navigate('/import')}
            >
              {t('buttons.import')}
            </DialogActionButton>
          </DialogActions>
        </DialogFooter>
      </CenterPanel>
    </DialogPrimitive>
  );
};
