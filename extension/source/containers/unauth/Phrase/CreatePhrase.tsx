import React, { FC } from 'react';
import { useHistory } from 'react-router-dom';
import { Button } from 'components/index';;
import { useController } from 'hooks/index';
import { Layout } from 'containers/common/Layout';

export const CreatePhrase: FC = () => {
  const history = useHistory();
  const controller = useController();

  const phrases = controller.wallet.generatePhrase();

  const nextHandler = () => {
    history.push('/create/phrase/check');
  };

  return (
    <Layout
      title="Recovery phrase"
      tooltipText="A recovery phrase is a series of 12 words in a specific order. This word combination is unique to your wallet. Make sure to have pen and paper ready so you can write it down."
      onlySection
    >
      <div className="flex justify-center items-center flex-col gap-4 mt-8">
        {phrases && (
          <ul className="list-none m-0 p-0 grid grid-cols-2 w-full gap-x-12">
            {phrases.split(' ').map((phrase: string, index: number) => (
              <li
                className="font-sans font-light text-sm leading-8 tracking-normal text-brand-graylight border-dashed border-b border-brand-graylight text-left w-32"
                key={index}
              >
                <span className="w-6 inline-block text-brand-royalBlue">
                  {String(index + 1).padStart(2, '0')}
                </span>

                {phrase}
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          classNameBorder="absolute bottom-12"
          onClick={nextHandler}
        >
          I've written it down
        </Button>
      </div>
    </Layout>
  );
};
