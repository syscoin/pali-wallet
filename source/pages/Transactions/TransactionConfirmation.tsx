import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  DefaultModal,
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
  Tooltip,
} from 'components/index';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';
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

const callbackResolver = async (txType: string, args: any[]) => {
  let callbackName:
    | 'confirmTokenCreation'
    | 'confirmNftCreation'
    | 'confirmTokenMint'
    | 'confirmUpdateToken'
    | 'transferAssetOwnership';

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

  return controllerEmitter(
    ['wallet', 'syscoinTransaction', callbackName],
    args
  );
};

const TransactionConfirmation: React.FC<ITransactionConfirmation> = ({
  host,
  transaction,
  type,
  title,
}) => {
  if (!transaction) throw { message: 'No transaction' };

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const { t } = useTranslation();
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  const [data, setData] = useState<ITxData[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const url = chrome.runtime.getURL('app.html');

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
      const message = `${t('transactions.youDontHave')} ${
        activeAccount.balances.syscoin
      }`;

      setLoading(false);
      setErrorMsg(message);
      return;
    }

    try {
      const response = await callbackResolver(type, [transaction]);

      setLoading(false);

      setSubmitted(true);

      dispatchBackgroundEvent(`tx${type}.${host}`, response);
    } catch (error: any) {
      const isNecessaryReconnect = error.message.includes(
        'read properties of undefined'
      );
      const isNecessaryBlindSigning = error.message.includes(
        'Please enable Blind signing'
      );
      if (activeAccount.isLedgerWallet && isNecessaryBlindSigning) {
        setErrorMsg(t('settings.ledgerBlindSigning'));
        setLoading(false);
        return;
      }
      if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
        setIsReconectModalOpen(true);
        setLoading(false);
        return;
      }
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
        title={`${capitalizeFirstLetter(title.toLowerCase())} ${t(
          'transactions.requestFailed'
        )}`}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || t('transactions.noDescriptionProvided')}
        buttonText="Ok"
      />

      <DefaultModal
        show={submitted}
        onClose={window.close}
        title={`${capitalizeFirstLetter(title.toLowerCase())} ${t(
          'transactions.signatureRequestWasRequest'
        )}`}
        description={t('transactions.youCanCheckYour')}
        buttonText={t('settings.gotIt')}
      />

      <DefaultModal
        show={isReconectModalOpen}
        title={t('settings.ledgerReconnection')}
        buttonText={t('buttons.reconnect')}
        description={t('settings.ledgerReconnectionMessage')}
        onClose={() => {
          setIsReconectModalOpen(false);
          window.close();
          window.open(`${url}?isReconnect=true`, '_blank');
        }}
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
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="submit"
            disabled={submitted}
            loading={loading}
            onClick={onSubmit}
          >
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>
    </>
  );
};

export default TransactionConfirmation;
