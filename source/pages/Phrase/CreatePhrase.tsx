import React, { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout, PrimaryButton } from 'components/index';
import { useController } from 'hooks/index';

export const CreatePhrase: FC = () => {
  const navigate = useNavigate();
  const controller = useController();

  const phrases = controller.wallet.generatePhrase();

  const nextHandler = () => {
    navigate('/phrase/confirm');
  };

  return (
    <Layout
      title="Recovery phrase"
      tooltipText="A recovery phrase is a series of 12 words in a specific order. This word combination is unique to your wallet. Make sure to have pen and paper ready so you can write it down."
      onlySection
    >
      <div className="flex flex-col gap-4 items-center justify-center max-w-xs">
        {phrases && (
          <ul className="grid gap-x-12 grid-cols-2 m-0 p-0 w-full list-none">
            {phrases.split(' ').map((phrase: string, index: number) => (
              <li
                className="w-32 text-left text-brand-graylight font-poppins text-sm font-light tracking-normal leading-8 border-b border-dashed border-brand-graylight"
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

        <div className="absolute bottom-12">
          <PrimaryButton type="button" width="56 px-6" onClick={nextHandler}>
            I've written it down
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
