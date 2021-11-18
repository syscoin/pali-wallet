import React, { FC } from 'react';
import { useController, useUtils } from 'hooks/index';
import { Layout } from '../../common/Layout';
import { Button } from 'antd';

const CreatePhrase: FC = () => {
  const controller = useController();
  const { history } = useUtils();

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
          <ul className="list-none m-0 p-0 grid grid-cols-2 w-full gap-x-8">
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
        
        <div className="p-0.5 bg-primary rounded-full">
          <Button
            className="absolute bottom-12 tracking-normal text-base leading-4 py-2.5 px-12 cursor-pointer rounded-full bg-brand-navy text-brand-white font-light border border-brand-royalBlue hover:bg-brand-royalBlue hover:text-brand-navy transition-all duration-300"
            onClick={nextHandler}
          >
            I've written it down
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default CreatePhrase;
