import React, { useEffect, useState } from 'react';
import { useAlert } from 'react-alert';

import {
  Layout,
  PrimaryButton,
  ErrorModal,
  DefaultModal,
  SecondaryButton,
} from 'components/index';
import { useStore } from 'hooks/index';
import { getController } from 'utils/browser';
import {
  ellipsis,
  formatUrl,
  capitalizeFirstLetter,
  camelCaseToText,
} from 'utils/index';

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
          <SecondaryButton
            type="button"
            action
            // onClick={() => rejectTransaction(browser, transaction, navigate)}
          >
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
  if (!psbt) throw new Error('No psbt');

  const alert = useAlert();
  const accountCtlr = getController().wallet.account;

  // TODO move to utils
  const base64 =
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

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

      window.close();

      return;
    }

    try {
      const response = await accountCtlr.sys.tx.signTransaction(
        psbt,
        signAndSend
      );

      setConfirmed(true);
      setLoading(false);

      // setTimeout(() => cancelTransaction(browser, psbt), 4000);

      // TODO dispatch background event
    } catch (error: any) {
      setFailed(true);
      setLogError(error.message);

      setTimeout(window.close, 4000);
    }
  };

  return (
    <>
      <DefaultModal
        onClose={window.close}
        show={!failed && confirmed}
        title={`${title.toLowerCase()} request successfully submitted`}
        description="You can check your request under activity on your home screen."
        buttonText="Got it"
      />

      <ErrorModal
        show={failed}
        onClose={window.close}
        title="Token creation request failed"
        description="Sorry, we could not submit your request. Try again later."
        log={logError || '...'}
        buttonText="Ok"
      />

      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
            <pre>
              {
                // TODO importPsbt
              }
              {/* {`${JSON.stringify(accountCtlr.importPsbt(psbt), null, 2)}`} */}
            </pre>
          </ul>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between">
            <SecondaryButton type="button" action onClick={window.close}>
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
      return 'confirmTokenCreation';

    case 'newNFT':
      return 'confirmNftCreation';

    case 'mintAsset':
      return 'confirmTokenMint';

    case 'mintNFT':
      return 'confirmMintNFT';

    // case 'transferAsset':
    //   return 'confirmAssetTransfer';

    case 'updateAsset':
      return 'confirmUpdateToken';

    default:
      throw new Error('Unknown transaction type');
  }
};

interface ITxConfirmLayout {
  sign?: boolean;
  signAndSend?: boolean;
  title: string;
  // transaction: any;
  txType: string;
}

export const TxConfirmLayout: React.FC<ITxConfirmLayout> = ({
  sign = false,
  signAndSend = false,
  title,
  // transaction,
  txType,
}) => {
  const transaction = null; // temporary

  const walletCtlr = getController().wallet;

  const callbackName = callbackNameResolver(txType);
  const callback = walletCtlr.account.sys.tx[callbackName];

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
