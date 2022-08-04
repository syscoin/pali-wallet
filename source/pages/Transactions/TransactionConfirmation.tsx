import React, { useEffect, useState } from 'react';

import {
  DefaultModal,
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useStore } from 'hooks/index';
import { getController } from 'utils/browser';
import {
  camelCaseToText,
  capitalizeFirstLetter,
  ellipsis,
  formatUrl,
} from 'utils/format';

interface ITransactionConfirmation {
  callback: any;
  title: string;
  transaction: any;
  txType: string;
}

interface ITxData {
  advanced: boolean;
  label: string;
  value: any;
}

const TransactionConfirmation: React.FC<ITransactionConfirmation> = ({
  callback,
  transaction,
  txType,
  title,
}) => {
  if (!transaction) throw new Error('No transaction');

  const { getRecommendedFee } = getController().wallet.account.sys.tx;
  const { activeAccount, activeNetwork } = useStore();

  const [data, setData] = useState<ITxData[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [logError, setLogError] = useState('');
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
    // let isPending = false;

    setLoading(true);

    if (activeAccount.balances.syscoin <= 0) return;

    // isPending = true;

    if (txType === 'newNFT') {
      setConfirmed(true);
      setLoading(false);
      setSubmitted(true);
    }

    try {
      const response = await callback(transaction);

      // isPending = false;
      setConfirmed(true);
      setLoading(false);
      setSubmitted(true);

      if (response) {
        // TODO dispatch background event
      }
    } catch (error: any) {
      setFailed(true);
      setLogError(error.message);

      const fee = await getRecommendedFee(activeNetwork.url);

      if (transaction.fee > fee) {
        const shortError = formatUrl(String(error.message), 166);
        setLogError(`${shortError} Please, reduce fees to send transaction.`);
      }

      if (transaction.fee < fee) {
        setLogError(error.message);
      }
    }

    /* setTimeout(() => {
        if (isPending && !confirmed) {
          setSubmitted(true);
          setFailed(false);
          setLogError('');
  
          setTimeout(() => {
            // cancelTransaction(browser, txType);
          }, 4000);
        }
      }, 8 * 60 * 1000); */
  };

  return (
    <>
      <ErrorModal
        show={failed}
        onClose={window.close}
        title={`${capitalizeFirstLetter(title.toLowerCase())} request failed`}
        description="Sorry, we could not submit your request. Try again later."
        log={logError || 'No description provided'}
        buttonText="Ok"
      />
      <DefaultModal
        show={!failed && submitted}
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
            loading={loading && !failed && !submitted}
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
