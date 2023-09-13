import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Modal, PrimaryButton, SecondaryButton } from 'components/index';

interface IValidationModalProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

export const ValidationModal = (props: IValidationModalProps) => {
  const { showModal, setIsOpen } = props;
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Modal
      show={showModal}
      onClose={() => {
        setIsOpen(false);
      }}
    >
      <div className="inline-block align-middle p-6 w-full max-w-2xl text-brand-white font-poppins bg-bkg-2 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
        <div className="flex flex-col items-center justify-center w-full">
          <p className="flex flex-col items-center justify-center mb-5 text-center font-poppins text-xs">
            <span className="font-rubik text-base">
              {t('settings.forgetWarning')}
            </span>
            <span className="font-rubik text-xs mb-4">
              {t('start.paliDoesnt')}
            </span>
            <span className="font-rubik text-xs text-brand-royalblue">
              {t('start.ifYouPlan')}
            </span>
          </p>

          <div className="flex flex-col gap-7 items-center justify-center w-full">
            <div className="flex items-center justify-between w-full md:max-w-2xl">
              <SecondaryButton type="button" onClick={() => setIsOpen(false)}>
                {t('buttons.cancel')}
              </SecondaryButton>

              <PrimaryButton
                type="button"
                width="40"
                onClick={() => navigate('/import')}
              >
                {t('buttons.import')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
