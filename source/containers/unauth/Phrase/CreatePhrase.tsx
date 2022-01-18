import React, { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { PrimaryButton } from 'components/index';
import { useController } from 'hooks/index';
import { Layout } from 'containers/common/Layout';

export const CreatePhrase: FC = () => {
  const navigate = useNavigate();
  const controller = useController();

  const phrases = controller.wallet.generatePhrase();

  const nextHandler = () => {
    navigate('/create/phrase/check');
  };

  return (
    <Layout
      title="Recovery phrase"
      tooltipText="A recovery phrase is a series of 12 words in a specific order. This word combination is unique to your wallet. Make sure to have pen and paper ready so you can write it down."
      onlySection
    >
      <div className="flex justify-center items-center flex-col gap-4 max-w-xs">
        {phrases && (
          <ul className="list-none m-0 p-0 grid grid-cols-2 w-full gap-x-12">
            {phrases.split(' ').map((phrase: string, index: number) => (
              <li
                className="font-poppins font-light text-sm leading-8 tracking-normal text-brand-graylight border-dashed border-b border-brand-graylight text-left w-32"
                key={phrase}
              >
                <span className="w-6 inline-block text-brand-royalblue">
                  {String(index + 1).padStart(2, '0')}
                </span>

                {phrase}
              </li>
            ))}
          </ul>
        )}

        <div className="absolute bottom-12">
          <PrimaryButton type="button" width="56" onClick={nextHandler}>
            I've written it down
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
