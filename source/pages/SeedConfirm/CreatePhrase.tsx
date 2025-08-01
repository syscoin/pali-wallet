import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button, SeedPhraseDisplay } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { useController } from 'hooks/useController';

export const CreatePhrase = ({ password }: { password: string }) => {
  const { controllerEmitter } = useController();
  const [seed, setSeed] = useState('');
  const { t } = useTranslation();

  const [copied, setCopied] = useState<boolean>(false);
  const [isTermsConfirmed, setIsTermsConfirmed] = useState<boolean>(false);

  const navigate = useNavigate();

  useEffect(() => {
    //todo: we need to call keyring manager with the new seed phrase function
    controllerEmitter(['wallet', 'createNewSeed']).then((response: string) => {
      setSeed(response);
    });
  }, []);

  const handleCopyToClipboard = useCallback(async (seedPhrase: string) => {
    try {
      await navigator.clipboard.writeText(seedPhrase);
      setCopied(true);
      // Reset copied state after a delay
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy seed:', error);
    }
  }, []);

  const handleNext = useCallback(() => {
    if (isTermsConfirmed) {
      navigate('/phrase', {
        state: { password, next: true, createdSeed: seed },
      });
    }
  }, [isTermsConfirmed, navigate, password, seed]);

  return (
    <OnboardingLayout title={t('createPhrase.recoveryPhrase')}>
      <div className="flex flex-col gap-4 items-center justify-center max-w-xs md:max-w-lg">
        <SeedPhraseDisplay
          seedPhrase={seed}
          isEnabled={true}
          showEyeToggle={true}
          onCopy={handleCopyToClipboard}
          copied={copied}
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

        <div className="absolute bottom-12 md:bottom-32">
          <Button
            disabled={!seed}
            id="unlock-btn"
            type="button"
            className={`bg-brand-deepPink100 ${
              isTermsConfirmed ? 'opacity-100' : 'opacity-60	'
            } w-[17.5rem] h-10 text-white text-base font-base font-medium rounded-2xl`}
            onClick={handleNext}
          >
            {t('buttons.next')}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
};
