import loadsh from 'lodash';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';

import { setActiveNetwork, web3Provider } from '@pollum-io/sysweb3-network';
import {
  getTokenStandardMetadata,
  isValidEthereumAddress,
} from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const CustomToken = () => {
  const controller = getController();

  const { navigate } = useUtils();

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const {
    reset,
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { isSubmitting, errors, isSubmitSuccessful },
  } = useForm();

  const onSubmit = async ({
    contractAddress,
    decimals,
  }: {
    contractAddress: string;
    decimals: number;
  }) => {
    try {
      setActiveNetwork(activeNetwork);

      const metadata = await getTokenStandardMetadata(
        contractAddress,
        activeAccount.address,
        web3Provider
      );

      const balance = `${metadata.balance / 10 ** metadata.decimals}`;
      const formattedBalance = loadsh.floor(parseFloat(balance), 4);

      if (!metadata) throw new Error('Could not find token metadata.');

      setValue('symbol', metadata.tokenSymbol.toUpperCase());

      await controller.wallet.account.eth.saveTokenInfo({
        tokenSymbol: metadata.tokenSymbol.toUpperCase(),
        contractAddress,
        decimals,
        balance: formattedBalance,
      });
    } catch (error) {
      setError('contractAddress', { message: JSON.stringify(error) });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md"
    >
      <input
        type="text"
        placeholder="Contract Address"
        className="input-small relative md:w-full"
        {...register('contractAddress', {
          required: true,
          validate: {
            isValid: (value) => isValidEthereumAddress(value),
          },
        })}
      />

      <input
        type="text"
        placeholder="Symbol"
        className="input-small relative md:w-full"
        {...register('symbol', {
          required: false,
        })}
      />

      <input
        type="number"
        placeholder="Decimals"
        className="input-small relative md:w-full"
        {...register('decimals', {
          required: true,
        })}
      />

      <NeutralButton
        loading={isSubmitting}
        className="absolute bottom-12 md:static"
        type="submit"
      >
        Import
      </NeutralButton>

      {isSubmitSuccessful && (
        <DefaultModal
          show={isSubmitSuccessful}
          title="Token successfully added"
          description="Token successfully added to your wallet."
          onClose={() => navigate('/home')}
        />
      )}

      {errors.contractAddress && errors.contractAddress.message && (
        <ErrorModal
          show={Boolean(errors.contractAddress.message)}
          title="Verify the current network"
          description="This token probably is not available in the current network. Verify the token network and try again."
          log="Token network probably is different from current network."
          onClose={reset}
        />
      )}
    </form>
  );
};
