import React, { useEffect, useState } from 'react';

import {
  DefaultModal,
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useStore } from 'hooks/index';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import {
  camelCaseToText,
  capitalizeFirstLetter,
  ellipsis,
  formatUrl,
} from 'utils/format';

interface ITransactionConfirmation {
  callback: any;
  host: string;
  title: string;
  transaction: any;
  type: string;
}

interface ITxData {
  advanced: boolean;
  label: string;
  value: any;
}

const TransactionConfirmation: React.FC<ITransactionConfirmation> = ({
  callback,
  host,
  transaction,
  type,
  title,
}) => {
  if (!transaction) throw new Error('No transaction');

  const { getRecommendedFee } = getController().wallet.account.sys.tx;
  const { activeAccount, activeNetwork } = useStore();

  const [data, setData] = useState<ITxData[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const advancedOptionsArray = [
    'notarydetails',
    'notaryAddress',
    'auxfeedetails',
    'payoutAddress',
    'capabilityflags',
    'contract',
  ];

  useEffect(() => {
    const txData: ITxData[] = [];
    for (const [key, value] of Object.entries(transaction)) {
      txData.push({
        label: key,
        value,
        advanced: advancedOptionsArray.includes(key),
      });
    }

    setData(txData);
  }, [transaction]);

  const onSubmit = async () => {
    setLoading(true);

    if (activeAccount.balances.syscoin <= 0) return;

    // TODO check this
    if (type === 'CreateNFT') {
      setLoading(false);
      setSubmitted(true);
    }

    try {
      const response = await callback(transaction);

      setLoading(false);
      setSubmitted(true);

      dispatchBackgroundEvent(`tx${type}.${host}`, response);
    } catch (error: any) {
      setErrorMsg(error.message);

      const fee = await getRecommendedFee(activeNetwork.url);

      if (transaction.fee > fee) {
        const shortError = formatUrl(String(error.message), 166);
        setErrorMsg(`${shortError} Please, reduce fees to send transaction.`);
      }

      if (transaction.fee < fee) {
        setErrorMsg(error.message);
      }
    }
  };

  return (
    <>
      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title={`${capitalizeFirstLetter(title.toLowerCase())} request failed`}
        description="Sorry, we could not submit your request. Try again later."
        log={errorMsg || 'No description provided'}
        buttonText="Ok"
      />
      <DefaultModal
        show={submitted}
        onClose={window.close}
        title={`${capitalizeFirstLetter(
          title.toLowerCase()
        )} request successfully submitted`}
        description="You can check your request under activity on your home screen."
        buttonText="Got it"
      />

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
          {data.map(
            (item) =>
              !item.advanced && (
                <li
                  key={item.label}
                  className="flex items-center justify-between my-2 p-2 w-full text-xs border-b border-dashed border-brand-royalblue"
                >
                  <p>{camelCaseToText(item.label)}</p>
                  <p>
                    {typeof item.value === 'string' && item.value.length > 10
                      ? ellipsis(item.value)
                      : item.value}
                  </p>
                </li>
              )
          )}
        </ul>

        <div className="absolute bottom-10 flex gap-3 items-center justify-between w-full max-w-xs md:max-w-2xl">
          <SecondaryButton type="button" action onClick={window.close}>
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="submit"
            action
            disabled={submitted}
            loading={loading}
            onClick={onSubmit}
          >
            Confirm
          </PrimaryButton>
        </div>
      </div>
    </>
  );
};

export default TransactionConfirmation;