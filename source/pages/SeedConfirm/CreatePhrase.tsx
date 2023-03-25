import React from 'react';
import { useNavigate } from 'react-router-dom';

import { OnboardingLayout, PrimaryButton } from 'components/index';
import { getController } from 'utils/browser';

export const CreatePhrase = ({ password }: { password: string }) => {
  const controller = getController();

  const navigate = useNavigate();

  //todo: we need to call keyring manager with the new seed phrase function
  const seed = controller.wallet.createSeed();

  return (
    <OnboardingLayout
      title="Recovery phrase"
      tooltipText="A recovery phrase is a series of 12 words in a specific order. This word combination is unique to your wallet. Make sure to have pen and paper ready so you can write it down."
    >
      <div className="flex flex-col gap-4 items-center justify-center max-w-xs md:max-w-lg">
        {seed && (
          <ul className="grid gap-x-12 grid-cols-2 m-0 p-0 w-full list-none">
            {seed.split(' ').map((phrase: string, index: number) => (
              <li
                className="w-32 text-left text-brand-graylight font-poppins text-sm font-light tracking-normal leading-8 border-b border-dashed border-brand-graylight md:w-56"
                key={phrase}
              >
                <span className="inline-block w-6 text-brand-royalblue">
                  {String(index + 1).padStart(2, '0')}
                </span>

                {phrase}
              </li>
            ))}
          </ul>
        )}

        <div className="absolute bottom-12 md:bottom-32">
          <PrimaryButton
            disabled={!seed}
            type="button"
            width="56 px-6"
            onClick={() =>
              navigate('/phrase', {
                state: { password, next: true, createdSeed: seed },
              })
            }
          >
            I've written it down
          </PrimaryButton>
        </div>
      </div>
    </OnboardingLayout>
  );
};
