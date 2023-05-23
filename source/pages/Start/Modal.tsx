import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Modal, PrimaryButton, SecondaryButton } from 'components/index';

interface IValidationModalProps {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showModal: boolean;
}

export const ValidationModal = (props: IValidationModalProps) => {
  const { showModal, setIsOpen } = props;
  const navigate = useNavigate();

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
            <span className="font-rubik text-base">Warning</span>
            <span className="font-rubik text-xs mb-4">
              Pali doesn't store your password. Regaining access requires a
              wallet reset with your Secret Recovery Phrase. This action erases
              the current wallet, created accounts, custom tokens, and imported
              accounts from your device, generating a new account tied to the
              reset phrase.
            </span>
            <span className="font-rubik text-xs text-brand-royalblue">
              If you plan to import a new Secret Recovery Phrase, ensure you've
              noted the current one to avoid losing associated funds. Remember,
              custom tokens and imported accounts will need to be re-added after
              the reset. This process is irreversible, so proceed with caution.
            </span>
          </p>

          <div className="flex flex-col gap-7 items-center justify-center w-full">
            <div className="flex items-center justify-between w-full md:max-w-2xl">
              <SecondaryButton type="button" onClick={() => setIsOpen(false)}>
                Cancel
              </SecondaryButton>

              <PrimaryButton
                type="button"
                width="40"
                onClick={() => navigate('/import')}
              >
                Import
              </PrimaryButton>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
