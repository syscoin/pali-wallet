import { uniqueId } from 'lodash';
import React from 'react';
import { useState, FC } from 'react';
import { FieldValues, useForm } from 'react-hook-form';

import { getTokenJson } from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

export const ImportToken: FC = () => {
  const controller = getController();

  const { navigate } = useUtils();

  const [list, setList] = useState([]);

  const {
    reset,
    register,
    handleSubmit,
    setValue,
    resetField,
    getValues,
    setError,
    watch,
    formState: { isSubmitting, errors, isSubmitSuccessful },
  } = useForm();

  const handleSearch = (query: string) => {
    resetField('token');

    const erc20Tokens = getTokenJson();

    if (!query) return setList(erc20Tokens);

    const filtered = Object.values(erc20Tokens).filter((token: any) => {
      if (!query || !token.name) return token;

      return token.name.toLowerCase().includes(query.toLowerCase());
    });

    setList(filtered);
  };

  const renderTokens = () => {
    const tokensList = list || getTokenJson();

    for (const [key, value] of Object.entries(tokensList)) {
      const tokenValue: any = value;

      tokensList[key] = {
        ...tokenValue,
        contractAddress: key,
      };
    }

    return Object.values(tokensList).map((token: any) => (
      <li
        {...register('token')}
        onClick={() => setValue('token', token)}
        key={uniqueId()}
        className={`p-3 hover:opacity-60 flex items-center justify-between text-xs border-b border-dashed cursor-pointer ${
          watch('token') && watch('token').tokenSymbol === token.tokenSymbol
            ? 'text-brand-royalblue'
            : 'text-brand-white'
        }`}
      >
        <p className="font-rubik font-medium">{token.tokenSymbol}</p>

        {token.erc20 && <p>ERC-20</p>}
      </li>
    ));
  };

  const onSubmit = async (data: FieldValues) => {
    if (!data.token) navigate('/home');

    try {
      await controller.wallet.account.eth.saveTokenInfo(data.token);
    } catch (error) {
      setError('token', { message: JSON.stringify(error) });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-left md:max-w-md"
    >
      <input
        type="text"
        placeholder="Search by symbol"
        className="input-small relative md:w-full"
        onChange={(event) => handleSearch(event.target.value)}
      />

      <ul className="scrollbar-styled w-full h-60 overflow-auto">
        {renderTokens()}
      </ul>

      <NeutralButton
        loading={isSubmitting}
        className="absolute bottom-12 md:static"
        type="submit"
      >
        {getValues().token
          ? `Import ${getValues().token.tokenSymbol}`
          : 'Close'}
      </NeutralButton>

      {isSubmitSuccessful && (
        <DefaultModal
          show={isSubmitSuccessful}
          title="Token successfully added"
          description="Token successfully added to your wallet."
          onClose={() => navigate('/home')}
        />
      )}

      {errors.token && errors.token.message && (
        <ErrorModal
          show={Boolean(errors.token.message)}
          title="Verify the current network"
          description="This token probably is not available in the current network. Verify the token network and try again."
          log="Token network probably is different from current network."
          onClose={reset}
        />
      )}
    </form>
  );
};
