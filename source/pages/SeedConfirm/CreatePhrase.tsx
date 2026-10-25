import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button, SeedPhraseDisplay } from 'components/index';
import { OnboardingLayout } from 'components/Layout/OnboardingLayout';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useController } from 'hooks/useController';
import { useOnboardingSecrets } from 'hooks/useOnboardingSecrets';

export const CreatePhrase = () => {
  const { controllerEmitter } = useController();
  const { secrets, setCreatedPhrase } = useOnboardingSecrets();
  // Native Back between the two /phrase steps stays in this live document.
  // Reuse its existing phrase without recovering anything from browser state.
  const livePhrase = secrets.kind === 'create' ? secrets.phrase || '' : '';
  const [seed, setSeed] = useState(livePhrase);
  const [wordCount, setWordCount] = useState<number>(
    livePhrase.trim().split(/\s+/).length === 24 ? 24 : 12
  );
  const generatedWordCount = useRef<number | null>(seed ? wordCount : null);
  const selectedWordCount = useRef(wordCount);
  selectedWordCount.current = wordCount;
  const generationRequest = useRef(0);
  const generationPending = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const { t } = useTranslation();

  const [acknowledgedSeed, setAcknowledgedSeed] = useState<string>();
  const hasCurrentSeed =
    generatedWordCount.current === wordCount &&
    !isGenerating &&
    !generationFailed;
  const isTermsConfirmed =
    hasCurrentSeed && Boolean(seed) && acknowledgedSeed === seed;

  const navigate = useNavigate();

  const generatePhrase = useCallback(
    (count: number) => {
      const request = ++generationRequest.current;
      generationPending.current = true;
      setIsGenerating(true);
      setGenerationFailed(false);
      setAcknowledgedSeed(undefined);
      const isCurrent = () =>
        request === generationRequest.current &&
        count === selectedWordCount.current;
      void controllerEmitter(['wallet', 'createNewSeed'], [count]).then(
        (response: string) => {
          if (isCurrent()) {
            generatedWordCount.current = count;
            generationPending.current = false;
            setSeed(response);
            setIsGenerating(false);
          }
        },
        () => {
          if (isCurrent()) {
            generatedWordCount.current = null;
            generationPending.current = false;
            setIsGenerating(false);
            setGenerationFailed(true);
          }
        }
      );
    },
    [controllerEmitter]
  );

  useEffect(() => {
    if (generatedWordCount.current !== wordCount) generatePhrase(wordCount);
    else {
      generationPending.current = false;
      setIsGenerating(false);
      setGenerationFailed(false);
    }
    return () => {
      generationRequest.current += 1;
      generationPending.current = false;
    };
  }, [generatePhrase, wordCount]);

  const handleNext = useCallback(() => {
    if (
      isTermsConfirmed &&
      !generationPending.current &&
      generatedWordCount.current === selectedWordCount.current
    ) {
      setCreatedPhrase(seed);
      navigate('/phrase', {
        state: { next: true },
      });
    }
  }, [isTermsConfirmed, navigate, setCreatedPhrase, seed]);

  return (
    <OnboardingLayout title={t('createPhrase.recoveryPhrase')}>
      <div className="flex flex-col gap-4 items-center justify-center max-w-xs md:max-w-lg pb-36 md:pb-48">
        <div className="flex items-center gap-3 w-full justify-center">
          <span className="text-brand-gray200 text-xs">
            {t('seedConfirm.words')}:
          </span>
          <select
            aria-label={t('seedConfirm.words')}
            className="bg-fields-input-primary border border-fields-input-border rounded-md text-brand-white text-sm px-2 py-1"
            value={wordCount}
            onChange={(e) => setWordCount(parseInt(e.target.value))}
          >
            <option value={12}>12</option>
            <option value={24}>24</option>
          </select>
          <Button
            type="button"
            onClick={() => generatePhrase(wordCount)}
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
        {isGenerating && <p role="status">{t('buttons.loading')}</p>}
        {generationFailed && (
          <p role="alert">{t('settings.walletSetupFailed')}</p>
        )}

        <div className="flex w-full flex-col space-y-6 mt-2 gap-2 z-20">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="custom-checkbox"
              disabled={!hasCurrentSeed}
              checked={isTermsConfirmed}
              onChange={(event) =>
                setAcknowledgedSeed(event.target.checked ? seed : undefined)
              }
            />
            <span className="text-brand-gray200 text-xs font-normal w-60">
              {t('seedConfirm.backupAcknowledgement')}
            </span>
          </label>
        </div>

        <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
          <div className="flex justify-center gap-3">
            <Button
              disabled={!isTermsConfirmed}
              id="unlock-btn"
              type="button"
              className={`bg-brand-deepPink100 ${
                isTermsConfirmed ? 'opacity-100' : 'opacity-60'
              } w-[17.5rem] h-10 text-bkg-1 text-base font-base font-medium rounded-2xl`}
              onClick={handleNext}
            >
              {t('buttons.next')}
            </Button>
          </div>
        </ToastActionFooter>
      </div>
    </OnboardingLayout>
  );
};
