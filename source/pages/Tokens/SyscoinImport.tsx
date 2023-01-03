import * as React from 'react';
import { useForm, FieldValues } from 'react-hook-form';
import { useSelector } from 'react-redux';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const SyscoinImportToken = () => {
  const {
    wallet: {
      account: {
        sys: { saveTokenInfo },
      },
    },
  } = getController();

  const { navigate } = useUtils();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { isValid, isSubmitting, errors, isSubmitSuccessful },
  } = useForm();

  const onSubmit = async ({ assetGuid }: FieldValues) => {
    try {
      const metadata = await getAsset(activeNetwork.url, assetGuid);

      if (!metadata || !metadata.symbol)
        throw new Error('Could not find token metadata.');

      await saveTokenInfo({
        ...metadata,
        symbol: metadata.symbol ? atob(String(metadata.symbol)) : '',
      });
    } catch (error) {
      console.log({ isValid });
      setError('assetGuid', {
        message: JSON.stringify(error),
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md"
    >
      <input
        type="number"
        placeholder="Token Guid"
        className="input-small relative md:w-full"
        {...register('assetGuid', {
          required: true,
        })}
      />

      <NeutralButton
        loading={isSubmitting}
        className="absolute bottom-12 md:static"
        type="submit"
      >
        Add token
      </NeutralButton>

      {isSubmitSuccessful && (
        <DefaultModal
          show={isSubmitSuccessful}
          title="Token successfully added"
          description="Token successfully added to your wallet."
          onClose={() => navigate('/home')}
        />
      )}

      {errors.assetGuid && errors.assetGuid.message && (
        <ErrorModal
          show={Boolean(errors.assetGuid.message)}
          title="Could not add token"
          description="Could not add token to your wallet. Check the network and the asset guid and try again later."
          log="Token not found in your XPUB or token is already imported."
          onClose={reset}
        />
      )}
    </form>
  );
};
