import React, { FC } from 'react';
import { useForm } from 'react-hook-form';

import { OnboardingLayout, PrimaryButton } from 'components/index';
import { getController } from 'utils/browser';
import { formatSeedPhrase } from 'utils/format';

interface IImportPhrase {
  onRegister: () => void;
}

const ImportPhrase: FC<IImportPhrase> = ({ onRegister }) => {
  const controller = getController();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const handleKeypress = (event: any) => {
    if (event.key === 'Enter') {
      handleSubmit(onRegister);
    }
  };

  return (
    <OnboardingLayout title="Import wallet">
      <form
        className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-center md:max-w-md"
        onSubmit={handleSubmit(onRegister)}
      >
        <textarea
          onKeyUp={handleKeypress}
          placeholder="Paste your wallet seed phrase"
          className="p-2 pl-4 w-full h-20 text-brand-graylight text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none"
          {...register('phrase', {
            required: true,
            setValueAs: (value) => formatSeedPhrase(value),
            validate: {
              checkSeedPhrase: (value) => controller.wallet.validateSeed(value),
            },
          })}
        />

        <span className="text-left text-brand-royalblue text-xs font-light">
          Importing your wallet seed automatically import a wallet associated
          with this seed phrase.
        </span>

        <PrimaryButton
          className="absolute bottom-12 md:bottom-80"
          type="submit"
          disabled={Boolean(errors.phrase)}
        >
          Import
        </PrimaryButton>
      </form>
    </OnboardingLayout>
  );
};

export default ImportPhrase;
