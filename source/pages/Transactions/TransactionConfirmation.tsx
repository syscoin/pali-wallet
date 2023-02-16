import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  DefaultModal,
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
  Tooltip,
} from 'components/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { camelCaseToText, capitalizeFirstLetter, ellipsis } from 'utils/format';

interface ITransactionConfirmation {
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

const callbackResolver = (txType: string) => {
  let callbackName;

  switch (txType) {
    case 'CreateToken':
      callbackName = 'confirmTokenCreation';
      break;

    case 'CreateNft':
      callbackName = 'confirmNftCreation';
      break;

    case 'MintToken':
      callbackName = 'confirmTokenMint';
      break;

    case 'MintNft':
      callbackName = 'confirmTokenMint';
      break;

    case 'UpdateToken':
      callbackName = 'confirmUpdateToken';
      break;
    case 'TransferToken':
      callbackName = 'transferAssetOwnership';
      break;

    default:
      throw new Error('Unknown transaction type');
  }

  return getController().wallet.account.sys.tx[callbackName];
};

const TransactionConfirmation: React.FC<ITransactionConfirmation> = ({
  host,
  transaction,
  type,
  title,
}) => {
  if (!transaction) throw { message: 'No transaction' };

  const { accounts, activeAccount: activeAccountId } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountId];

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

    if (activeAccount.balances.syscoin <= 0) {
      const message = `You don't have enough funds to process this transaction. Your actual balance is: ${activeAccount.balances.syscoin}`;

      setLoading(false);
      setErrorMsg(message);
      return;
    }

    try {
      const callback = callbackResolver(type);
      const response = await callback(transaction);
      setLoading(false);
      setSubmitted(true);

      dispatchBackgroundEvent(`tx${type}.${host}`, response);
    } catch (error: any) {
      if (error.message.includes('txVersion'))
        error.message =
          "Inputs or outputs are empty. Maybe you don't have enough funds for this transaction.";
      setLoading(false);
      setErrorMsg(error.message);
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
          {data.map((item) => {
            const valueValidation =
              typeof item.value === 'string' && item.value.length > 10;

            return (
              !item.advanced && (
                <li
                  key={item.label}
                  className="flex items-center justify-between my-2 p-2 w-full text-xs border-b border-dashed border-brand-royalblue"
                >
                  <p>{camelCaseToText(item.label)}</p>
                  <p
                    className={
                      valueValidation ? 'hover:text-brand-royalblue' : ''
                    }
                  >
                    {valueValidation ? (
                      <Tooltip content={item.value}>
                        {ellipsis(item.value)}
                      </Tooltip>
                    ) : (
                      item.value
                    )}
                    {typeof item.value === 'boolean' &&
                      (item.value ? 'Yes' : 'No')}
                    {!item.value && '-'}
                  </p>
                </li>
              )
            );
          })}
        </ul>

        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton type="button" onClick={window.close}>
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="submit"
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
