import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import {
  DefaultModal,
  ErrorModal,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData } from 'hooks/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';

interface ISign {
  send?: boolean;
}

const Sign: React.FC<ISign> = ({ send = false }) => {
  const { host, eventName, ...data } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const url = browser.runtime.getURL('app.html');
  const { activeAccount: activeAccountData, accounts } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountData.type][activeAccountData.id];
  const onSubmit = async () => {
    const { syscoinTransaction } = getController().wallet;
    const sign = syscoinTransaction.signTransaction;

    setLoading(true);

    try {
      const response = await sign(data, send);

      setConfirmed(true);
      setLoading(false);

      dispatchBackgroundEvent(`${eventName}.${host}`, response);
    } catch (error: any) {
      const isNecessaryReconnect = error.message.includes(
        'read properties of undefined'
      );
      if (activeAccount.isLedgerWallet && isNecessaryReconnect) {
        setIsReconectModalOpen(true);
        setLoading(false);
        return;
      }
      setErrorMsg(error.message);

      setTimeout(window.close, 4000);
    }
  };

  return (
    <Layout canGoBack={false} title={t('transactions.signatureRequest')}>
      <DefaultModal
        show={confirmed}
        onClose={window.close}
        title={t('transactions.signatureRequestWasRequest')}
        description={
          send
            ? t('transactions.theDappHas')
            : t('transactions.youCanCheckYour')
        }
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

      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || '...'}
        buttonText="Ok"
      />

      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <ul className="scrollbar-styled mt-8 px-4 w-full h-80 text-xs overflow-auto">
            <pre>{`${JSON.stringify(data, null, 2)}`}</pre>
          </ul>

          <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
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
    </Layout>
  );
};

export default Sign;
