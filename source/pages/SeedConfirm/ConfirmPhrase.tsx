import shuffle from 'lodash/shuffle';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { StatusModal } from 'components/Modal/StatusModal';
import { WalletReadyModal } from 'components/Modal/WarningBaseModal';

export const ConfirmPhrase = ({
  passed,
  confirmPassed,
  seed,
  setPassed,
}: {
  confirmPassed: () => Promise<void>;
  passed: boolean;
  seed: string;
  setPassed: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
  const [orgList, setOrgList] = useState<Array<string>>(
    shuffle((seed || '').split(' '))
  );
  const [showModal, setShowModal] = useState(false);

  const { t } = useTranslation();

  const [newList, setNewList] = useState<Array<string>>([]);

  const handleOrgPhrase = (idx: number) => {
    const tempList = [...orgList];
    setNewList([...newList, orgList[idx]]);
    tempList.splice(idx, 1);
    setOrgList([...tempList]);
  };

  const handleNewPhrase = (idx: number) => {
    const tempList = [...newList];
    setOrgList([...orgList, newList[idx]]);
    tempList.splice(idx, 1);
    setNewList([...tempList]);
  };

  const handleValidate = () => {
    if (newList.toString().replaceAll(',', ' ') === seed) {
      setPassed(true);
    } else {
      setPassed(false);
      setShowModal(true);
    }
  };

  const closeModal = () => {
    setShowModal(false);
  };

  return (
    <OnboardingLayout title={t('seedConfirm.confirmRecovery')}>
      <div className="flex flex-col gap-4 items-center justify-center mt-2 text-brand-white transition-all duration-300 ease-in-out">
        <>
          <section className="flex flex-wrap gap-3 items-center justify-center p-3 w-11/12 border-b border-[rgba(255, 255, 255, 0.16)] before:border-b before:border-[rgba(255, 255, 255, 0.16)] box-border transition-all duration-300 md:w-9/12">
            {newList.map((phrase, idx) => (
              <Button
                useDefaultWidth={false}
                className="flex gap-4 items-center justify-center px-3 py-1 min-w-xs h-7 text-brand-white text-xs font-normal tracking-normal leading-4 bg-brand-blue rounded-md z-20"
                key={`${phrase}-${idx}-new`}
                type="button"
                onClick={() => handleNewPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>
          <section className="flex flex-wrap gap-3 items-center justify-center w-11/12 box-border transition-all duration-300 md:w-9/12">
            {orgList.map((phrase, idx) => (
              <Button
                useDefaultWidth={false}
                className="flex gap-4 items-center justify-center px-3 py-1 min-w-xs h-7 text-brand-white text-xs font-normal tracking-normal leading-4 bg-transparent border border-brand-blue rounded-[10px] z-20"
                key={`${phrase}-${idx}-org`}
                type="button"
                onClick={() => handleOrgPhrase(idx)}
              >
                {phrase}
              </Button>
            ))}
          </section>

          <div className="absolute bottom-12">
            <Button
              className={`bg-brand-deepPink100 ${
                orgList.length ? 'opacity-60' : 'opacity-100'
              } w-[17.5rem] h-10 text-white text-base font-base font-medium rounded-2xl`}
              type="button"
              onClick={() => {
                !orgList?.length ? handleValidate() : null;
              }}
            >
              {t('buttons.validate')}
            </Button>
          </div>
        </>
        {showModal && !passed && (
          <StatusModal
            show={showModal}
            title={'Error'}
            description={t('seedConfirm.seedError')}
            onClose={closeModal}
            status="error"
          />
        )}
        <WalletReadyModal
          show={passed}
          title={t('seedConfirm.yourWalletIsReady')}
          phraseOne={t('seedConfirm.youShould')}
          onClose={confirmPassed}
        />
      </div>
    </OnboardingLayout>
  );
};
