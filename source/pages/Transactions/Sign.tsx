import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import {
  Button,
  DefaultModal,
  ErrorModal,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { TokenSuccessfulyAdded } from 'components/Modal/WarningBaseModal';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';

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
      <TokenSuccessfulyAdded
        show={confirmed}
        onClose={window.close}
        title={t('transactions.signatureRequestWasRequest')}
        phraseOne={
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
        <div className="flex flex-col items-start">
          <div className="flex flex-col w-full items-center justify-center mb-8">
            <div className="w-16 h-16  relative p-4 mb-6 rounded-[100px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
              <img className="absolute" src="/assets/images/signature.svg" />
            </div>
            <p className="text-sm text-white">
              {t('transactions.signatureRequest')}
            </p>
            <p className="text-sm text-gray-200">
              {t('transactions.confirmToProceed')}
            </p>
          </div>
          <div className="bg-brand-blue600 rounded-t-[20px] ml-[15px] py-[8px] px-[16px] h-[40px] w-[92px] text-base font-normal cursor-pointer hover:opacity-60 text-center ">
            Data
          </div>
          <div className="bg-brand-blue600 w-[396px] relative left-[0%] flex flex-col items-center justify-center p-6 rounded-[20px]">
            <ul className="scrollbar-styled px-4 w-full text-xs overflow-auto">
              <pre>{`${JSON.stringify(data, null, 2)}`}</pre>
            </ul>

            <div className="absolute bottom-[-7.5rem] flex items-center justify-between px-10 w-full gap-2 md:max-w-2xl">
              <Button
                type="button"
                onClick={window.close}
                className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-white text-base bg-transparent hover:opacity-60 border border-white rounded-[100px] transition-all duration-300 xl:flex-none"
              >
                {t('buttons.cancel')}
              </Button>

              <Button
                type="submit"
                disabled={confirmed}
                loading={loading}
                onClick={onSubmit}
                className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300 xl:flex-none"
              >
                {t('buttons.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Sign;
