import React, { FC, useEffect, useState } from 'react';
import {
  useController,
  usePopup,
  useUtils,
  useFormat,
  useTransaction,
  useAccount,
  useBrowser,
} from 'hooks/index';
import {
  AuthViewLayout,
  PrimaryButton,
  Modal,
  SecondaryButton,
} from 'components/index';

type ITxConfirm = {
  callback: any;
  temporaryTransaction: any;
  temporaryTransactionStringToClear: string;
  title: string;
};
const TxConfirm = ({
  callback,
  temporaryTransaction,
  temporaryTransactionStringToClear,
  title,
}: ITxConfirm) => {
  const controller = useController();

  const { ellipsis, formatURL, capitalizeFirstLetter } = useFormat();
  const { closePopup } = usePopup();
  const { navigate } = useUtils();
  const { activeAccount } = useAccount();
  const { browser } = useBrowser();
  const { handleRejectTransaction, handleCancelTransactionOnSite } =
    useTransaction();

  const [data, setData] = useState([]);
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
    if (temporaryTransaction) {
      const newData: any = {};

      Object.entries(temporaryTransaction).map(([key, value]) => {
        if (!newData[key]) {
          newData[key] = {
            label: key,
            value,
            advanced: advancedOptionsArray.includes(key),
          };
        }
      });

      setData(Object.values(newData));
    }
  }, [temporaryTransaction]);

  const handleConfirmSiteTransaction = async () => {
    const recommendedFee = await controller.wallet.account.getRecommendFee();

    let isPending = false;

    setLoading(true);

    if ((activeAccount ? activeAccount.balance : -1) > 0) {
      isPending = true;

      try {
        if (temporaryTransactionStringToClear === 'newNFT') {
          setConfirmed(true);
          setLoading(false);
          setSubmitted(true);
        }

        const response =
          await controller.wallet.account.confirmTemporaryTransaction({
            type: temporaryTransactionStringToClear,
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

        if (error && temporaryTransaction.fee > recommendedFee) {
          setLogError(
            `${formatURL(
              String(error.message),
              166
            )} Please, reduce fees to send transaction.`
          );
        }

        if (error && temporaryTransaction.fee < recommendedFee) {
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
            handleCancelTransactionOnSite(
              browser,
              temporaryTransactionStringToClear
            );
          }, 4000);
        }
      }, 8 * 60 * 1000);
    }
  };

  return (
    <>
      {failed ? (
        <Modal
          type="error"
          onClose={closePopup}
          open={failed}
          title={`${capitalizeFirstLetter(title.toLowerCase())} request failed`}
          description="Sorry, we could not submit your request. Try again later."
          log={logError || 'No description provided'}
          closeMessage="Ok"
        />
      ) : (
        <>
          {submitted && (
            <Modal
              type="default"
              closePopup={closePopup}
              onClose={closePopup}
              open={submitted && !failed}
              title={`${capitalizeFirstLetter(
                title.toLowerCase()
              )} request successfully submitted`}
              description="You can check your request under activity on your home screen."
              closeMessage="Got it"
            />
          )}
        </>
      )}

      {temporaryTransaction && (
        <div className="flex flex-col items-center justify-center w-full">
          <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
            {data &&
              data.map((item: any) => (
                <>
                  {!item.advanced && (
                    <li
                      key={item.label}
                      className="flex items-center justify-between my-2 p-2 w-full text-xs border-b border-dashed border-brand-royalblue"
                    >
                      <p>{item.label}</p>
                      <p>
                        {typeof item.value === 'string' &&
                        item.value.length > 10
                          ? ellipsis(item.value)
                          : item.value}
                      </p>
                    </li>
                  )}
                </>
              ))}
          </ul>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between w-full max-w-xs md:max-w-2xl">
            <SecondaryButton
              type="button"
              action
              onClick={() =>
                handleRejectTransaction(browser, temporaryTransaction, navigate)
              }
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

type ITxConfirmSign = {
  psbt: any;
  signAndSend?: boolean;
  title?: string;
};

const TxConfirmSign = ({
  psbt,
  signAndSend = false,
  title = 'SIGNATURE REQUEST',
}: ITxConfirmSign) => {
  const controller = useController();
  const base64 =
    /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

  const { closePopup } = usePopup();
  const { navigate, alert } = useUtils();
  const { browser } = useBrowser();
  const { handleRejectTransaction, handleCancelTransactionOnSite } =
    useTransaction();

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [logError, setLogError] = useState('');

  const handleConfirmSignature = () => {
    setLoading(true);

    if (!base64.test(psbt.psbt) || typeof psbt.assets !== 'string') {
      alert.removeAll();
      alert.error(
        'PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.'
      );

      setTimeout(() => {
        handleCancelTransactionOnSite(browser, psbt);
      }, 10000);

      return;
    }

    controller.wallet.account
      .signTransaction(psbt, signAndSend)
      .then((response: any) => {
        if (response) {
          setConfirmed(true);
          setLoading(false);

          setTimeout(() => {
            handleCancelTransactionOnSite(browser, psbt);
          }, 4000);

          browser.runtime.sendMessage({
            type: 'TRANSACTION_RESPONSE',
            target: 'background',
            response,
          });
        }
      })
      .catch((error: any) => {
        if (error) {
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
            handleCancelTransactionOnSite(browser, psbt);
          }, 4000);
        }
      });
  };

  return (
    <>
      {confirmed && (
        <Modal
          type="default"
          closePopup={closePopup}
          onClose={closePopup}
          open={confirmed && !failed}
          title={`${title.toLowerCase()} request successfully submitted`}
          description="You can check your request under activity on your home screen."
          closeMessage="Got it"
        />
      )}

      {failed && (
        <Modal
          type="error"
          onClose={closePopup}
          open={failed}
          title="Token creation request failed"
          description="Sorry, we could not submit your request. Try again later."
          log={logError || '...'}
          closeMessage="Ok"
        />
      )}

      {psbt && !loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <ul className="scrollbar-styled mt-4 px-4 w-full h-80 text-xs overflow-auto">
            <pre>
              {`${JSON.stringify(
                controller.wallet.account.importPsbt(psbt),
                null,
                2
              )}`}
            </pre>
          </ul>

          <div className="absolute bottom-10 flex gap-3 items-center justify-between">
            <SecondaryButton
              type="button"
              action
              onClick={() => handleRejectTransaction(browser, psbt, navigate)}
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

export type ITxConfirmLayout = {
  callback?: any;
  sign?: boolean;
  signAndSend?: boolean;
  temporaryTransaction: string;
  temporaryTransactionStringToClear: string;
  title: string;
};

export const TxConfirmLayout: FC<ITxConfirmLayout> = ({
  sign,
  title,
  callback,
  temporaryTransaction,
  temporaryTransactionStringToClear,
  signAndSend,
}) => (
  <AuthViewLayout canGoBack={false} title={title}>
    {sign ? (
      <TxConfirmSign
        psbt={temporaryTransaction}
        signAndSend={signAndSend}
        title="SIGNATURE REQUEST"
      />
    ) : (
      <TxConfirm
        callback={callback}
        temporaryTransaction={temporaryTransaction}
        temporaryTransactionStringToClear={temporaryTransactionStringToClear}
        title={title}
      />
    )}
  </AuthViewLayout>
);
