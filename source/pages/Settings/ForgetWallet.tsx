import React from 'react';
import { useForm, FieldValues } from 'react-hook-form';
import { useSelector } from 'react-redux';

import { Layout, SecondaryButton, PrimaryButton, Card } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { formatSeedPhrase } from 'utils/format';

const ForgetWalletView = () => {
  const { navigate } = useUtils();

  const controller = getController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  if (!activeAccount) throw new Error('No active account');

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, isValid },
  } = useForm();

  const hasAccountFunds =
    (isBitcoinBased
      ? activeAccount.balances.syscoin
      : activeAccount.balances.ethereum) > 0;

  const onSubmit = ({ password }: FieldValues) => {
    controller.wallet.forgetWallet(password);

    navigate('/');
  };

  return (
    <Layout title="FORGET WALLET">
      <Card type="info">
        <p>
          <b className="text-warning-info">WARNING:</b> This will forget the
          wallet created with your current seed phrase. If in the future you
          want to use Pali again, you will need to create a new wallet using
          your seed or creating a new one.
        </p>
      </Card>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 items-center justify-start mt-4 w-full max-w-xs h-full text-left md:max-w-md"
      >
        <input
          type="password"
          placeholder="Enter your password"
          className="input-small relative md:w-full"
          {...register('password', {
            required: true,
            validate: {
              checkPwd: (value) => controller.wallet.checkPassword(value),
            },
          })}
        />

        {hasAccountFunds && (
          <>
            <p className="max-w-xs text-left text-xs leading-4 md:max-w-md">
              You still have funds in your wallet. Paste your seed phrase below
              to forget wallet.
            </p>

            <textarea
              placeholder="Paste your wallet seed phrase"
              className="p-2 pl-4 w-full h-20 text-brand-graylight text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none"
              {...register('phrase', {
                required: hasAccountFunds,
                deps: ['password'],
                setValueAs: (value) => formatSeedPhrase(value),
                validate: {
                  checkSeedPhrase: (value) =>
                    controller.wallet.validateSeed(value),
                },
              })}
            />
          </>
        )}

        <div className="absolute bottom-12 flex gap-x-8 justify-between md:static md:gap-x-40">
          <PrimaryButton type="button" onClick={() => navigate('/home')}>
            Cancel
          </PrimaryButton>

          <SecondaryButton
            type="submit"
            disabled={!isValid}
            loading={isSubmitting}
          >
            Forget
          </SecondaryButton>
        </div>
      </form>
    </Layout>
  );
};

export default ForgetWalletView;
