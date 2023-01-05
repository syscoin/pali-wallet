import React from 'react';
import { useForm } from 'react-hook-form';

import { OnboardingLayout, PrimaryButton } from 'components/index';

interface IPasswordForm {
  onSubmit: (data: any) => any;
}

export const PasswordForm: React.FC<IPasswordForm> = ({ onSubmit }) => {
  const { register, handleSubmit, getValues } = useForm();

  return (
    <OnboardingLayout title="Password">
      <form
        className="password flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-center md:max-w-md"
        onSubmit={handleSubmit(onSubmit)}
      >
        <input
          type="password"
          placeholder="New password (min 8 chars)"
          className="input-small relative md:w-full"
          {...register('password', {
            required: true,
            deps: ['repassword'],
            validate: {
              checkPwdMatch: (value) =>
                /^(?=.*[a-z])(?=.*[0-9])(?=.{8,})/.test(value),
            },
          })}
        />

        <input
          type="password"
          placeholder="Confirm password"
          className="input-small relative md:w-full"
          {...register('repassword', {
            required: true,
            deps: ['password'],
            validate: {
              checkRePwdMatch: (value) =>
                Boolean(!value || getValues().password === value),
            },
          })}
        />

        <span className="px-3 w-full text-left text-brand-graylight text-xs">
          At least 8 characters, 1 lower-case and 1 numeral. {'   '}
        </span>

        <span className="px-3 text-left text-brand-royalblue text-xs">
          Do not forget to save your password. You will need this password to
          unlock your wallet.
        </span>

        <PrimaryButton
          className="absolute bottom-12 md:bottom-32"
          type="submit"
        >
          Next
        </PrimaryButton>
      </form>
    </OnboardingLayout>
  );
};
