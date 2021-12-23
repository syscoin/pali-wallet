import React, { useEffect, useState } from 'react';
import {
  useController,
  usePopup,
  useUtils,
  useFormat,
  useTransaction,
  useAccount,
  useBrowser
} from 'hooks/index';

import { AuthViewLayout } from 'containers/common/Layout';
import {
  Icon,
  PrimaryButton,
  Modal,
  SecondaryButton
} from 'components/index';

const ConfirmDefaultTransaction = ({
  confirmTransaction,
  temporaryTransaction,
  temporaryTransactionStringToClear,
  submittingData,
  title
}) => {
  const controller = useController();

  const { ellipsis, formatURL } = useFormat();
  const { closePopup } = usePopup();
  const { history } = useUtils();
  const { activeAccount } = useAccount();
  const { browser } = useBrowser();
  const {
    handleRejectTransaction,
    handleCancelTransactionOnSite,
  } = useTransaction();

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
        if (temporaryTransactionStringToClear === 'mintNFT') {
          setConfirmed(true);
          setLoading(false);
          setSubmitted(true);
        }

        const response = await confirmTransaction();

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
          setLogError(`${formatURL(String(error.message), 166)} Please, reduce fees to send transaction.`);
        }

        if (error && temporaryTransaction.fee < recommendedFee) {
          setLogError(error.message);
        }

        browser.runtime.sendMessage({
          type: 'WALLET_ERROR',
          target: 'background',
          transactionError: true,
          invalidParams: false,
          message: "Sorry, we could not submit your request. Try again later."
        });
      }

      setTimeout(() => {
        if (isPending && !confirmed) {
          setSubmitted(true);
          setFailed(false)
          setLogError('');

          setTimeout(() => {
            handleCancelTransactionOnSite(browser, temporaryTransactionStringToClear);
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
          title={`${title.toLowerCase()} request failed`}
          description="Sorry, we could not submit your request. Try again later."
          log={logError ? logError : 'No description provided'}
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
              title={`${title.toLowerCase()} request successfully submitted`}
              description="You can check your request under activity on your home screen."
              closeMessage="Got it"
            />
          )}
        </>
      )}

      {temporaryTransaction && !loading && (
        <div className="flex justify-center flex-col items-center w-full">
          <ul className="scrollbar-styled text-xs overflow-auto w-full px-4 h-80 mt-4">
            {data && data.map((item: any) => (
              <>
                {!item.advanced && (
                  <li
                    key={item.label}
                    className="flex justify-between p-2 my-2 border-b border-dashed border-brand-royalBlue items-center w-full text-xs"
                  >
                    <p>{item.label}</p>
                    <p>{typeof item.value === 'string' && item.value.length > 10 ? ellipsis(item.value) : item.value}</p>
                  </li>
                )}
              </>
            ))}
          </ul>

          <div className="flex justify-between items-center absolute bottom-10 gap-3">
            <SecondaryButton
              type="button"
              onClick={() => handleRejectTransaction(browser, temporaryTransaction, history)}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              disabled={submitted}
              loading={loading}
              onClick={handleConfirmSiteTransaction}
            >
              Confirm
            </PrimaryButton>
          </div>
        </div>
      )}

      {submittingData || loading && (
        <Icon
          name="loading"
          wrapperClassname="absolute top-1/2 left-1/2"
          className="w-4 text-brand-white"
        />
      )}
    </>
  )
}

const ConfirmSignTransaction = ({
  temporaryTransaction,
  signAndSend = false,
  title = 'SIGNATURE REQUEST',
  submittingData
}) => {
  const controller = useController();
  const base64 = /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)$/;

  const psbt = controller.wallet.account.getTransactionItem()[temporaryTransaction];

  const { closePopup } = usePopup();
  const { history, alert } = useUtils();
  const { browser } = useBrowser();
  const {
    handleRejectTransaction,
    handleCancelTransactionOnSite,
  } = useTransaction();

  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [logError, setLogError] = useState('');

  const handleConfirmSignature = () => {
    setLoading(true);

    if (!base64.test(psbt.psbt) || typeof psbt.assets !== 'string') {
      alert.removeAll();
      alert.error(`PSBT must be in Base64 format and assets must be a JSON string. Please check the documentation to see the correct formats.`);

      setTimeout(() => {
        handleCancelTransactionOnSite(browser, temporaryTransaction);
      }, 10000);

      return;
    }

    controller.wallet.account
      .confirmSignature(signAndSend)
      .then((response: any) => {
        if (response) {
          setConfirmed(true);
          setLoading(false);

          setTimeout(() => {
            handleCancelTransactionOnSite(browser, temporaryTransaction);
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
            handleCancelTransactionOnSite(browser, temporaryTransaction);
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
          log={logError ? logError : '...'}
          closeMessage="Ok"
        />
      )}

      {temporaryTransaction && !loading && (
        <div className="flex justify-center flex-col items-center w-full">
          <ul className="scrollbar-styled text-xs overflow-auto w-full px-4 h-80 mt-4">
            <pre>{`${JSON.stringify(
              controller.wallet.account.importPsbt(psbt),
              null,
              2
            )}`}</pre>
          </ul>

          <div className="flex justify-between items-center absolute bottom-10 gap-3">
            <SecondaryButton
              type="button"
              onClick={() => handleRejectTransaction(browser, temporaryTransaction, history)}
            >
              Cancel
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              disabled={confirmed}
              loading={loading}
              onClick={handleConfirmSignature}
            >
              Confirm
            </PrimaryButton>
          </div>
        </div>
      )}

      {submittingData || loading && (
        <Icon
          name="loading"
          wrapperClassname="absolute top-1/2 left-1/2"
          className="w-4 text-brand-white"
        />
      )}
    </>
  )
}

export const ConfirmTransaction = ({
  sign,
  title,
  confirmTransaction,
  temporaryTransaction,
  temporaryTransactionStringToClear,
  submittingData,
  signAndSend
}) => {
  return (
    <AuthViewLayout canGoBack={false} title={title}>
      {sign ? (
        <ConfirmSignTransaction
          temporaryTransaction={temporaryTransaction}
          signAndSend={signAndSend}
          title="SIGNATURE REQUEST"
          submittingData={submittingData}
        />
      ) : (
        <ConfirmDefaultTransaction
          confirmTransaction={confirmTransaction}
          temporaryTransaction={temporaryTransaction}
          temporaryTransactionStringToClear={temporaryTransactionStringToClear}
          submittingData={submittingData}
          title={title}
        />
      )}
    </AuthViewLayout>
  );
}