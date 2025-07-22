import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { PrimaryButton, SecondaryButton, ErrorModal } from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { SyscoinTransactionDetailsFromPSBT } from 'components/TransactionDetails';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  isUserCancellationError,
  isDeviceLockedError,
} from 'utils/isUserCancellationError';
import { clearNavigationState } from 'utils/navigationState';

interface ISign {
  signOnly?: boolean;
}

const Sign: React.FC<ISign> = ({ signOnly = false }) => {
  const { controllerEmitter } = useController();
  const { host, eventName, ...data } = useQueryData();
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const { activeAccount: activeAccountData, accounts } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountData.type][activeAccountData.id];

  // Handle initial data loading
  useEffect(() => {
    const processInitialData = async () => {
      try {
        // Small delay to ensure data is properly loaded
        await new Promise((resolve) => setTimeout(resolve, 100));
        setInitialLoading(false);
      } catch (error) {
        console.error('Error processing initial data:', error);
        setInitialLoading(false);
      }
    };

    if (data) {
      processInitialData();
    } else {
      setInitialLoading(false);
    }
  }, [data]);

  const onSubmit = async () => {
    setLoading(true);
    try {
      let response = null;

      response = await controllerEmitter(
        ['wallet', 'syscoinTransaction', 'signPSBT'],
        [
          {
            psbt: data,
            isTrezor: activeAccount.isTrezorWallet,
            isLedger: activeAccount.isLedgerWallet,
            pathIn: data?.pathIn,
          },
        ]
      );
      if (!signOnly) {
        response = await controllerEmitter(
          ['wallet', 'syscoinTransaction', 'sendTransaction'],
          [
            response, // Pass the signed PSBT
          ]
        );
        // Save transaction to local state for immediate visibility
        await controllerEmitter(
          ['wallet', 'sendAndSaveTransaction'],
          [response]
        );
      }
      // Show success toast
      alert.success(
        signOnly
          ? t('transactions.theDappHas')
          : t('transactions.youCanCheckYour')
      );
      dispatchBackgroundEvent(`${eventName}.${host}`, response);
      setConfirmed(true);
      setLoading(false);
      clearNavigationState();
      setTimeout(window.close, 2000);
    } catch (error: any) {
      // Handle user cancellation gracefully
      if (isUserCancellationError(error)) {
        alert.info(t('transactions.transactionCancelled'));
        setLoading(false);
        return;
      }

      // Handle device locked
      if (isDeviceLockedError(error)) {
        setErrorMsg(t('settings.lockedDevice'));
        setLoading(false);
        return;
      }

      // Handle structured errors from syscoinjs-lib
      if (error.error && error.code) {
        switch (error.code) {
          case 'TRANSACTION_SEND_FAILED':
            // Parse error message to extract meaningful part
            let cleanErrorMsg = error.message;
            try {
              // Check if the message contains JSON error details
              const detailsMatch = cleanErrorMsg.match(/Details:\s*({.*})/);
              if (detailsMatch) {
                const errorDetails = JSON.parse(detailsMatch[1]);
                if (errorDetails.error) {
                  cleanErrorMsg = errorDetails.error;
                }
              }
            } catch (e) {
              // If parsing fails, use the original message
            }
            setErrorMsg(`Transaction failed to send: ${cleanErrorMsg}`);
            break;
          default:
            setErrorMsg(`Transaction error (${error.code}): ${error.message}`);
        }
      } else {
        setErrorMsg(error.message);
      }

      setLoading(false);
      createTemporaryAlarm({
        delayInSeconds: 4,
        callback: () => window.close(),
      });
    }
  };

  // Clear navigation state when component unmounts or navigates away
  useEffect(
    () => () => {
      clearNavigationState();
    },
    []
  );

  return (
    <>
      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || '...'}
        buttonText="Ok"
      />

      {initialLoading ? (
        <div className="flex items-center justify-center min-h-[400px]">
          <LoadingComponent />
        </div>
      ) : (
        <div className="flex flex-col w-full h-screen">
          {/* Main scrollable content area */}
          <div className="flex-1 overflow-y-auto pb-20 remove-scrollbar">
            {/* Header Section */}
            <div className="flex flex-col w-full items-center justify-center px-6 py-8">
              <div className="w-16 h-16 relative p-4 mb-6 rounded-full bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
                <img
                  className="absolute inset-0 w-full h-full p-4"
                  src="/assets/all_assets/signature.svg"
                  alt="Signature"
                />
              </div>
              <h1 className="text-xl font-semibold text-white mb-2">
                {t('transactions.signatureRequest')}
              </h1>
              <p className="text-sm text-gray-300 text-center">
                {t('transactions.confirmToProceed')}
              </p>
              {host && (
                <p className="text-xs text-gray-400 text-center mt-1">
                  from <span className="font-medium">{host}</span>
                </p>
              )}
            </div>

            {/* Transaction Details Section */}
            <div className="w-full max-w-2xl mx-auto px-6">
              <SyscoinTransactionDetailsFromPSBT
                psbt={data}
                showTechnicalDetails={false}
                showTransactionOptions={false}
              />
            </div>
          </div>

          {/* Fixed button container at bottom */}
          <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <div className="flex gap-3 justify-center">
              <SecondaryButton
                type="button"
                disabled={loading}
                onClick={window.close}
              >
                {t('buttons.cancel')}
              </SecondaryButton>

              <PrimaryButton
                type="submit"
                disabled={confirmed}
                loading={loading}
                onClick={onSubmit}
              >
                {signOnly ? t('buttons.sign') : t('buttons.confirm')}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Sign;
