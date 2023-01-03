import shuffle from 'lodash/shuffle';
import React, { useState } from 'react';

import {
  Button,
  DefaultModal,
  PrimaryButton,
  OnboardingLayout,
} from 'components/index';

export const ConfirmPhrase = ({
  passed,
  confirmPassed,
  seed,
}: {
  confirmPassed: any;
  passed: boolean;
  seed: string;
}) => {
  const [orgList, setOrgList] = useState<Array<string>>(
    shuffle((seed || '').split(' '))
  );

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

  return (
    <OnboardingLayout title="Confirm Recovery Phrase">
      <div className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-center md:max-w-md">
        <section className="flex flex-wrap gap-3 items-center justify-center p-3 w-11/12 border-b border-brand-graylight box-border transition-all duration-300 md:w-9/12">
          {newList.map((phrase, idx) => (
            <Button
              useDefaultWidth={false}
              className="flex gap-4 items-center justify-center px-3 py-1 min-w-xs h-7 text-brand-white text-xs font-bold tracking-normal leading-4 bg-brand-royalblue border border-brand-royalblue rounded-md"
              key={phrase}
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
              className="flex gap-4 items-center justify-center px-3 py-1 min-w-xs h-7 text-brand-white text-xs font-bold tracking-normal leading-4 bg-bkg-2 border border-bkg-4 rounded-md"
              key={phrase}
              type="button"
              onClick={() => handleOrgPhrase(idx)}
            >
              {phrase}
            </Button>
          ))}
        </section>

        <PrimaryButton
          className="absolute bottom-12"
          type="button"
          onClick={confirmPassed}
        >
          Validate
        </PrimaryButton>

        <DefaultModal
          show={passed}
          title="YOUR WALLET IS READY"
          description="You should now have your recovery phrase and your wallet password written down for future reference."
          onClose={confirmPassed}
        />
      </div>
    </OnboardingLayout>
  );
};

export default ConfirmPhrase;
