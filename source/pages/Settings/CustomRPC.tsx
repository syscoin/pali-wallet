import { Switch } from '@headlessui/react';
import { chains } from 'eth-chains';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { Location, useLocation } from 'react-router-dom';

import { DefaultModal, Layout, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { IRpcParams } from 'types/transactions';
import { getController } from 'utils/browser';
import { validateRpc } from 'utils/network';

const CustomRPCView = () => {
  const { networks } = useSelector((state: RootState) => state.vault);
  const { state }: Location = useLocation();

  const rpcEditState = state as { chain: string; chainId: number };

  const isUtxoChain =
    rpcEditState &&
    rpcEditState.chain &&
    Boolean(rpcEditState.chain === 'syscoin');

  const [isUtxo, setIsUtxo] = useState(isUtxoChain);
  const [feedback, setFeedback] = useState({
    success: false,
    error: '',
  });

  const { navigate } = useUtils();

  const {
    wallet: { addCustomRpc, editCustomRpc },
  } = getController();

  const {
    handleSubmit,
    register,
    setValue,
    reset,
    getValues,
    formState: { errors },
  } = useForm({
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: IRpcParams) => {
    try {
      const chain = isUtxo ? 'syscoin' : 'ethereum';
      const method = state ? editCustomRpc : addCustomRpc;

      await method(chain, { ...data, chainId: getValues().chainId });

      setFeedback({
        ...feedback,
        success: true,
      });
    } catch (error) {
      setFeedback({
        ...feedback,
        error: JSON.stringify(error),
      });
    }
  };

  const populate = () => {
    if (!state || !rpcEditState || !rpcEditState.chainId) return;

    const network = networks[rpcEditState.chain][rpcEditState.chainId];

    const fieldsByNetwork = {
      ...network,
      explorerUrl: network.explorer,
    };

    const formFields = ['label', 'url', 'chainId', 'explorerUrl'];

    const values: any = {};

    for (const field of formFields) {
      const value = fieldsByNetwork[field];

      values[field] = value;
    }

    reset({ ...values });
  };

  useEffect(() => {
    populate();
  }, [state]);

  useEffect(() => {
    reset();
  }, [isUtxo]);

  return (
    <Layout title="CUSTOM RPC">
      <form
        className="flex flex-col gap-3 items-center justify-center text-center"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex gap-x-2 mb-4 text-xs">
          <p className="text-brand-royalblue text-xs">Ethereum</p>

          <Switch
            checked={isUtxo}
            onChange={() => setIsUtxo(!isUtxo)}
            className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
          >
            <span className="sr-only">Syscoin Network</span>
            <span
              className={`${
                isUtxo
                  ? 'translate-x-6 bg-brand-deepPink100'
                  : 'translate-x-1 bg-brand-royalblue'
              } inline-block w-2 h-2 transform rounded-full`}
            />
          </Switch>

          <p className="text-brand-deepPink100 text-xs">Syscoin</p>
        </div>

        <input
          placeholder="Name of the network"
          className="input-small relative md:w-full"
          {...register('label', { required: true })}
        />

        <input
          placeholder="RPC URL"
          className="input-small relative border-warning-error md:w-full"
          {...register('url', {
            required: true,
            validate: {
              checkUrl: async (value) => {
                try {
                  const chainId = await validateRpc(value, isUtxo);

                  setValue('chainId', parseInt(chainId, 16));

                  return !!chainId;
                } catch (error) {
                  return 'Invalid RPC URL.';
                }
              },
            },
          })}
        />

        {errors.url && errors.url.message && (
          <span className="text-brand-deepPink100 text-xs">
            Invalid RPC URL. Try checking the RPC URL on{' '}
            <a
              target="_blank"
              className="text-brand-royalbluemedium"
              href="https://chainlist.org/"
              rel="noreferrer"
            >
              ChainList.
            </a>
          </span>
        )}

        <input
          placeholder="Chain ID"
          className="input-small relative md:w-full"
          {...register('chainId', {
            required: true,
            disabled: true,
          })}
        />

        <input
          placeholder="Block Explorer URL (optional)"
          className="input-small relative md:w-full"
          {...register('explorerUrl', {
            required: false,
            validate: {
              checkExplorerUrl: (value) => {
                if (!value) return true;

                const { chainId, url } = getValues();

                if (!chainId || !url) return false;

                const details = chains.getById(chainId);

                const hasExplorers =
                  details && details.explorers && details.explorers[0];

                if (!hasExplorers) return false;

                const isValid = details.explorers.filter(
                  (explorer) =>
                    value &&
                    new URL(explorer.url).origin === new URL(value).origin
                );

                return Boolean(isValid[0]);
              },
            },
          })}
        />

        {errors.explorerUrl && (
          <span className="text-brand-deepPink100 text-xs">
            Invalid Block Explorer URL.
          </span>
        )}

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit">Save</NeutralButton>
        </div>
      </form>

      <DefaultModal
        show={feedback.success && !feedback.error}
        onClose={() => {
          setFeedback({
            success: false,
            error: '',
          });

          navigate('/settings/networks/edit');
        }}
        title="RPC added successfully"
        description="Now you can set the active network to your added RPC and edit it at Manage Networks page."
      />
    </Layout>
  );
};

export default CustomRPCView;
