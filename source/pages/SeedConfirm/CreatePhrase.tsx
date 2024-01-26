import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { OnboardingLayout, Button } from 'components/index';
import { getController } from 'utils/browser';

export const CreatePhrase = ({ password }: { password: string }) => {
  const controller = getController();
  const { t } = useTranslation();

  const [visible, setVisible] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isTermsConfirmed, setIsTermsConfirmed] = useState<boolean>(false);

  const navigate = useNavigate();

  //todo: we need to call keyring manager with the new seed phrase function
  const seed = useMemo(() => controller.wallet.createNewSeed(), []);

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(seed);
  };

  return (
    <OnboardingLayout title={t('createPhrase.recoveryPhrase')}>
      <div className="flex flex-col gap-4 items-center justify-center max-w-xs md:max-w-lg">
        <div className="flex gap-3 items-start p-[0.938rem] w-[17.5rem] max-w-[17.5rem] border border-brand-blue200 rounded-[10px] bg-brand-blue800">
          <div
            className={`flex flex-wrap flex-row gap-1 bg-brand-blue800 ${
              visible ? '' : 'filter blur-sm'
            }`}
          >
            {seed.split(' ').map((phrase: string, index: number) => (
              <p key={index} className="flex text-white text-sm font-light ">
                {phrase}
              </p>
            ))}
          </div>
          <div className="flex bg-brand-blue800">
            {visible ? (
              <img
                className="w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                onClick={() => setVisible(false)}
                src="/assets/icons/visibleEye.svg"
              />
            ) : (
              <img
                className="w-[18px] max-w-none cursor-pointer hover:cursor-pointer z-20"
                onClick={() => setVisible(true)}
                src="/assets/icons/notVisibleEye.svg"
              />
            )}
          </div>
        </div>

        <div className="flex w-full flex-col space-y-6 mt-2 z-20">
          {isCopied ? (
            <div className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer">
              <img
                className="w-[16px] max-w-none"
                src="/assets/icons/successIcon.svg"
              />
              <p className="text-sm text-white">Copied!</p>
            </div>
          ) : (
            <div
              className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer"
              onClick={() => {
                handleCopyToClipboard();
                setIsCopied(true);
              }}
            >
              <img className="max-w-none z-20 " src="/assets/icons/copy.svg" />
              <p className="text-sm text-white">Copy</p>
            </div>
          )}
        </div>

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
            onClick={() => {
              isTermsConfirmed
                ? navigate('/phrase', {
                    state: { password, next: true, createdSeed: seed },
                  })
                : null;
            }}
          >
            {t('buttons.next')}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
};
