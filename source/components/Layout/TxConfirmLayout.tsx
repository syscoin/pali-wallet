import React, { useEffect, useState } from 'react';
import { useUtils, useStore } from 'hooks/index';
import { browser } from 'webextension-polyfill-ts';
import {
  Layout,
  PrimaryButton,
  ErrorModal,
  DefaultModal,
  SecondaryButton,
} from 'components/index';
import { useNavigate } from 'react-router-dom';
import {
  ellipsis,
  formatUrl,
  capitalizeFirstLetter,
  rejectTransaction,
  cancelTransaction,
  camelCaseToText,
} from 'utils/index';
import { getController } from 'utils/browser';

interface ITxConfirm {
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

const TxConfirm: React.FC<ITxConfirm> = ({
  callback,
  transaction,
  txType,
  title,
}) => {
  const navigate = useNavigate();
  const accountController = getController().wallet.account;
  const { activeAccount } = useStore();

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
    if (!transaction) return;

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

  const handleConfirmSiteTransaction = async () => {
    const recommendedFee = await accountController.tx.getRecommendedFee();

    let isPending = false;

    setLoading(true);

    if ((activeAccount ? activeAccount.balances.syscoin : -1) > 0) {
      isPending = true;

      try {
        if (txType === 'newNFT') {
          setConfirmed(true);
          setLoading(false);
          setSubmitted(true);
        }

        const response = await accountController.tx.sendTransaction({
          type: txType,
          callback,
        });

        isPending = false;

        setConfirmed(true);
        setLoading(false);
        setSubmitted(true);

        if (response) {
          browser.runtime.sendMessage({
            type: 'TRANSACTION_RESPONSE',
            target: 'background',
            response,
          });
        }
      } catch (error: any) {
        setFailed(true);
        setLogError(error.message);

        if (error && transaction.fee > recommendedFee) {
          setLogError(
            `${formatUrl(
              String(error.message),
              166
            )} Please, reduce fees to send transaction.`
          );
        }

        if (error && transaction.fee < recommendedFee) {
          setLogError(error.message);
        }

        browser.runtime.sendMessage({
          type: 'WALLET_ERROR',
          target: 'background',
          transactionError: true,
          invalidParams: false,
          message: 'Sorry, we could not submit your request. Try again later.',
        });
      }

      setTimeout(() => {
        if (isPending && !confirmed) {
          setSubmitted(true);
          setFailed(false);
          setLogError('');

          setTimeout(() => {
            cancelTransaction(browser, txType);
          }, 4000);
        }
      }, 8 * 60 * 1000);
    }
  };

  return (
    <>
      {failed ? (
        <ErrorModal
          onClose={() => window.close()}
          title={`${capitalizeFirstLetter(title.toLowerCase())} request failed`}
          description="Sorry, we could not submit your request. Try again later."
          log={logError || 'No description provided'}
          buttonText="Ok"
        />
      ) : (
        <DefaultModal
          show={submitted}
          onClose={() => window.close()}
          title={`${capitalizeFirstLetter(
            title.toLowerCase()
          )} request successfully submitted`}
          description="You can check your request under activity on your home screen."
          buttonText="Got it"
        />
      )}

      {transaction && (
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
            <SecondaryButton
              type="button"
              action
              onClick={() => rejectTransaction(browser, transaction, navigate)}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              action
              disabled={submitted}
              loading={loading && !failed && !submitted}
              onClick={handleConfirmSiteTransaction}
            >
              Confirm
            </PrimaryButton>
          </div>
        </div>
      )}
    </>
  );
};

interface ITxConfirmSign {
  psbt: any;
  signAndSend?: boolean;
  title?: string;
}

const TxConfirmSign: React.FC<ITxConfirmSign> = ({
  psbt,
  signAndSend = false,
  title = 'SIGNATURE REQUEST',
}) => {
  const accountCtlr = getController().wallet.account;
  const base64 =
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

  const { navigate, alert } = useUtils();

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [logError, setLogError] = useState('');

  const handleConfirmSignature = async () => {
    setLoading(true);

    if (!base64.test(psbt.psbt) || typeof psbt.assets !== 'string') {
      alert.removeAll();
      alert.error(
        'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.'
      );

      setTimeout(() => {
        cancelTransaction(browser, psbt);
      }, 10000);

      return;
    }

    try {
      const response = await accountCtlr.signTransaction(psbt, signAndSend);
      if (response) {
        setConfirmed(true);
        setLoading(false);

        setTimeout(() => {
          cancelTransaction(browser, psbt);
        }, 4000);

        browser.runtime.sendMessage({
          type: 'TRANSACTION_RESPONSE',
          target: 'background',
          response,
        });
      }
    } catch (error: any) {
      setFailed(true);
      setLogError(error.message);

      browser.runtime.sendMessage({
        type: 'WALLET_ERROR',
        target: 'background',
        transactionError: true,
        invalidParams: false,
        message: "Can't sign transaction. Try again later.",
      });

      setTimeout(() => {
        cancelTransaction(browser, psbt);
      }, 4000);
    }
  };

  return (
    <>
      {confirmed && (
        <DefaultModal
          onClose={() => window.close()}
          show={!failed}
          title={`${title.toLowerCase()} request successfully submitted`}
          description="You can check your request under activity on your home screen."
          buttonText="Got it"
        />
      )}

      {failed && (
        <ErrorModal
          onClose={() => window.close()}
          title="Token creation request failed"
          description="Sorry, we could not submit your request. Try again later."
          log={logError || '...'}
          buttonText="Ok"
        />
      )}

      {psbt && !loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
            <pre>
              {`${JSON.stringify(accountCtlr.importPsbt(psbt), null, 2)}`}
            </pre>
          </ul>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between">
            <SecondaryButton
              type="button"
              action
              onClick={() => rejectTransaction(browser, psbt, navigate)}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              action
              disabled={confirmed}
              loading={loading && !failed && !confirmed}
              onClick={handleConfirmSignature}
            >
              Confirm
            </PrimaryButton>
          </div>
        </div>
      )}
    </>
  );
};

const callbackNameResolver = (txType: string) => {
  switch (txType) {
    case 'newAsset':
      return 'confirmSPTCreation';

    case 'newNFT':
      return 'confirmCreateNFT';

    case 'mintAsset':
      return 'confirmMintSPT';

    case 'mintNFT':
      return 'confirmMintNFT';

    case 'transferAsset':
      return 'confirmAssetTransfer';

    case 'updateAsset':
      return 'confirmUpdateAsset';

    default:
      throw new Error('Unknown transaction type');
  }
};

interface ITxConfirmLayout {
  sign?: boolean;
  signAndSend?: boolean;
  title: string;
  txType: string;
}

export const TxConfirmLayout: React.FC<ITxConfirmLayout> = ({
  sign = false,
  signAndSend = false,
  title,
  txType,
}) => {
  const walletCtlr = getController().wallet;
  const { getTemporaryTransaction } = walletCtlr.account.tx;

  const transaction = getTemporaryTransaction(txType);

  const callbackName = callbackNameResolver(txType);
  const callback = walletCtlr.account[callbackName];

  return (
    <Layout canGoBack={false} title={title}>
      {sign ? (
        <TxConfirmSign
          psbt={transaction}
          signAndSend={signAndSend}
          title="SIGNATURE REQUEST"
        />
      ) : (
        <TxConfirm
          callback={callback}
          transaction={transaction}
          txType={txType}
          title={title}
        />
      )}
    </Layout>
  );
};
