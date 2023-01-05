import React, { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import {
  FeeInputWithPrefix,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { camelCaseToText } from 'utils/format';

import TransactionConfirmation from './TransactionConfirmation';

const titleResolver = (txType: string) =>
  camelCaseToText(txType).toUpperCase() || 'TRANSACTION';

interface ITransaction {
  type: string;
}

/**
 * Alternates between Fee and Confirmation page
 */
const Transaction: React.FC<ITransaction> = ({ type }) => {
  const methods = useForm({
    defaultValues: {
      fee: 0,
    },
  });

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { host, ...transaction } = useQueryData();
  const navigate = useNavigate();

  const title = titleResolver(type);

  const { getRecommendedFee } = getController().wallet.account.sys.tx;

  const getFeeByNetwork = async () => {
    if (isBitcoinBased) return await getRecommendedFee(activeNetwork.url);

    return 0;
  };

  const setup = async () => {
    const fee = await getFeeByNetwork();

    methods.reset({ fee });
    methods.setValue('fee', fee);
  };

  const setFee = async ({ fee }: { fee: number }) => {
    if (!fee) return;

    const externalData = { host, ...transaction, fee };

    if (type !== 'Send') return;

    navigate('/external/tx/send/confirm?data=' + JSON.stringify(externalData));
  };

  useEffect(() => {
    setup();
  }, []);

  if (!methods.watch('fee'))
    return (
      <FormProvider {...methods}>
        <form
          className="flex flex-col gap-4 items-center justify-start w-full max-w-xs h-full text-center md:max-w-md"
          onSubmit={methods.handleSubmit(setFee)}
        >
          <h1 className="mt-4 text-sm">FEE</h1>

          <FeeInputWithPrefix disabled={isBitcoinBased} />

          <p className="mt-4 mx-5 p-4 w-80 text-left text-xs bg-transparent border border-dashed border-gray-600 rounded-lg md:w-96">
            With current network conditions, we recommend a fee of{' '}
            {methods.getValues('fee')} SYS.
          </p>

          <div className="absolute bottom-12 flex items-center justify-between px-10 w-full md:max-w-2xl">
            <SecondaryButton type="button" onClick={window.close}>
              Cancel
            </SecondaryButton>

            <PrimaryButton type="submit">Next</PrimaryButton>
          </div>
        </form>
      </FormProvider>
    );

  return (
    <Layout canGoBack={false} title={title}>
      <TransactionConfirmation
        host={host}
        title={title}
        type={type}
        transaction={{ ...transaction, fee: methods.getValues().fee }}
      />
    </Layout>
  );
};

export default Transaction;
