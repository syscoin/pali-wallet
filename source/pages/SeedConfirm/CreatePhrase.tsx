import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button, SeedPhraseDisplay } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { useController } from 'hooks/useController';

export const CreatePhrase = ({ password }: { password: string }) => {
  const { controllerEmitter } = useController();
  const [seed, setSeed] = useState('');
  const [wordCount, setWordCount] = useState<number>(12);
  const { t } = useTranslation();

  const [isTermsConfirmed, setIsTermsConfirmed] = useState<boolean>(false);

  const navigate = useNavigate();

  useEffect(() => {
    controllerEmitter(['wallet', 'createNewSeed'], [wordCount]).then(
      (response: string) => {
        setSeed(response);
      }
    );
  }, [controllerEmitter, wordCount]);

  const handleNext = useCallback(() => {
    if (isTermsConfirmed) {
      navigate('/phrase', {
        state: { password, next: true, createdSeed: seed },
      });
    }
  }, [isTermsConfirmed, navigate, password, seed]);

  return (
    <OnboardingLayout title={t('createPhrase.recoveryPhrase')}>
      <div className="flex flex-col gap-4 items-center justify-center max-w-xs md:max-w-lg pb-36 md:pb-48">
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="text-brand-gray200 text-xs">Words:</span>
          <select
            className="bg-fields-input-primary border border-fields-input-border rounded-md text-brand-white text-sm px-2 py-1"
            value={wordCount}
            onChange={(e) => setWordCount(parseInt(e.target.value))}
          >
            <option value={12}>12</option>
            <option value={24}>24</option>
          </select>
          <Button
            type="button"
            onClick={() =>
              controllerEmitter(['wallet', 'createNewSeed'], [wordCount]).then(
                (response: string) => setSeed(response)
              )
            }
            className="bg-brand-blue px-3 py-1 h-8 text-xs rounded-md"
          >
            {t('buttons.generate')}
          </Button>
        </div>
        <SeedPhraseDisplay
          seedPhrase={seed}
          isEnabled={true}
          showEyeToggle={true}
          displayMode="words"
          className="w-[17.5rem] max-w-[17.5rem]"
        />

        <div className="flex w-full flex-col space-y-6 mt-2 gap-2 z-20">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="custom-checkbox"
              onClick={() => setIsTermsConfirmed(!isTermsConfirmed)}
            />
            <span className="text-brand-gray200 text-xs font-normal w-60">
              I'm aware that this word combination is unique to identify my
              wallet, and I have to save this information properly to not lose
              my wallet and funds in the future.
            </span>
          </label>
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
          <div className="flex justify-center gap-3">
            <Button
              disabled={!seed}
              id="unlock-btn"
              type="button"
              className={`bg-brand-deepPink100 ${
                isTermsConfirmed ? 'opacity-100' : 'opacity-60'
              } w-[17.5rem] h-10 text-white text-base font-base font-medium rounded-2xl`}
              onClick={handleNext}
            >
              {t('buttons.next')}
            </Button>
          </div>
        </div>
      </div>
    </OnboardingLayout>
  );
};
