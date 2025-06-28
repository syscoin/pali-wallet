import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  PrimaryButton,
  SecondaryButton,
  DefaultModal,
  ErrorModal,
} from 'components/index';
import { SyscoinTransactionDetailsFromPSBT } from 'components/TransactionDetails';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';

interface ISign {
  signOnly?: boolean;
}

const Sign: React.FC<ISign> = ({ signOnly = false }) => {
  const { controllerEmitter } = useController();
  const { host, eventName, ...data } = useQueryData();
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const url = chrome.runtime.getURL('app.html');
  const { activeAccount: activeAccountData, accounts } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountData.type][activeAccountData.id];

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
      }

      setConfirmed(true);
      setLoading(false);
      dispatchBackgroundEvent(`${eventName}.${host}`, response);

      // Show success toast

      alert.success(
        signOnly
          ? t('transactions.theDappHas')
          : t('transactions.youCanCheckYour')
      );

      // Close window after a short delay
      setTimeout(() => window.close(), 2000);
    } catch (error: any) {
      const isNecessaryReconnect = error.message?.includes(
        'read properties of undefined'
      );

      if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
        setIsReconectModalOpen(true);
        setLoading(false);
        return;
      }

      // Handle structured errors from syscoinjs-lib
      if (error.error && error.code) {
        switch (error.code) {
          case 'TRANSACTION_SEND_FAILED':
            setErrorMsg(`Transaction failed to send: ${error.message}`);
            break;
          default:
            setErrorMsg(`Transaction error (${error.code}): ${error.message}`);
        }
      } else {
        setErrorMsg(error.message);
      }

      createTemporaryAlarm({
        delayInSeconds: 4,
        callback: () => window.close(),
      });
    }
  };

  return (
    <>
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

      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || '...'}
        buttonText="Ok"
      />

      {!loading && (
        <div className="flex flex-col items-start">
          <div className="flex flex-col w-full items-center justify-center mb-8">
            <div className="w-16 h-16  relative p-4 mb-6 rounded-[100px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
              <img
                className="absolute"
                src="/assets/all_assets/signature.svg"
              />
            </div>
            <p className="text-sm text-white">
              {t('transactions.signatureRequest')}
            </p>
            <p className="text-sm text-gray-200">
              {t('transactions.confirmToProceed')}
            </p>
          </div>

          <div className="w-full px-6">
            <SyscoinTransactionDetailsFromPSBT
              psbt={data}
              showTechnicalDetails={false}
              showTransactionOptions={false}
            />
          </div>

          <div className="absolute bottom-[-7.5rem] flex items-center justify-between px-10 w-full gap-6 md:max-w-2xl">
            <SecondaryButton type="button" onClick={window.close}>
              {t('buttons.cancel')}
            </SecondaryButton>

            <PrimaryButton
              type="submit"
              disabled={confirmed}
              loading={loading}
              onClick={onSubmit}
            >
              {t('buttons.confirm')}
            </PrimaryButton>
          </div>
        </div>
      )}
    </>
  );
};

export default Sign;
