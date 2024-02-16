import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import { DefaultModal, ErrorModal, Layout, Button } from 'components/index';
import { useQueryData } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';

interface ISign {
  send?: boolean;
}
const EthSign: React.FC<ISign> = () => {
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<string>('Details');
  const [errorMsg, setErrorMsg] = useState('');
  const [message, setMessage] = useState<string>('');
  const [isReconectModalOpen, setIsReconectModalOpen] =
    useState<boolean>(false);

  const tabLabel = ['Details', 'Data'];
  const url = browser.runtime.getURL('app.html');
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const { label, balances, address } = activeAccount;
  const { currency } = activeNetwork;

  const warningMessage = t('transactions.warningSignMessage');

  const onSubmit = async () => {
    const { ethereumTransaction } = getController().wallet;

    setLoading(true);

    try {
      let response = '';
      const type = data.eventName;
      if (data.eventName === 'eth_sign')
        response = await ethereumTransaction.ethSign(data);
      else if (data.eventName === 'personal_sign')
        response = await ethereumTransaction.signPersonalMessage(data);
      else {
        let typedData;
        if (
          typeof data[0] === 'string' &&
          data[0].toLowerCase() === address.toLowerCase()
        ) {
          typedData = data[1];
        } else if (
          typeof data[1] === 'string' &&
          data[1].toLowerCase() === address.toLowerCase()
        ) {
          typedData = data[0];
        } else {
          throw { message: 'Signing for wrong address' };
        }
        if (typeof typedData === 'string') typedData = JSON.parse(typedData);
        if (data.eventName === 'eth_signTypedData') {
          response = await ethereumTransaction.signTypedData(
            address,
            typedData,
            'V1'
          );
        } else if (data.eventName === 'eth_signTypedData_v3') {
          response = await ethereumTransaction.signTypedData(
            address,
            typedData,
            'V3'
          );
        } else if (data.eventName === 'eth_signTypedData_v4') {
          response = await ethereumTransaction.signTypedData(
            address,
            typedData,
            'V4'
          );
        }
      }
      setConfirmed(true);
      setLoading(false);

      dispatchBackgroundEvent(`${type}.${host}`, response);
      window.close();
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
      console.log(error);
      setErrorMsg(error.message);

      setTimeout(window.close, 40000);
    }
  };
  useEffect(() => {
    const { ethereumTransaction } = getController().wallet;
    if (data.eventName === 'personal_sign') {
      const msg = data[0] === activeAccount.address ? data[1] : data[0];
      const parsedMessage = ethereumTransaction.parsePersonalMessage(msg);
      setMessage(parsedMessage);
    }
    if (data.eventName === 'eth_sign') {
      setMessage(data[1]);
    }
  }, []);

  const AccountDetailsSignature = () => (
    <>
      <div className="flex flex-row justify-between mb-2 w-full font-poppins text-xs text-white">
        <p>{t('transactions.account')}</p>
        <p>{label}</p>
      </div>
      <div className="flex flex-row justify-between mb-2 w-full font-poppins text-xs text-white">
        <p>{t('send.balance')}</p>
        <div className="flex gap-1">
          <p>{balances[isBitcoinBased ? 'syscoin' : 'ethereum']}</p>
          <p className="text-brand-blue200">{currency.toUpperCase()}</p>
        </div>
      </div>
      <div className="flex flex-row justify-between mb-2 w-full font-poppins text-xs text-white">
        <p>{t('transactions.origin')}</p>
        <p>{host}</p>
      </div>
    </>
  );

  const DataSignature = () => (
    <>
      {(data.eventName === 'eth_signTypedData_v3' ||
        data.eventName === 'eth_signTypedData_v4') && (
        <div className="flex flex-col pb-4 pt-4 w-full">
          <div className="scrollbar-styled mt-1 px-4 w-full h-40 text-xs overflow-auto">
            <pre>{`${JSON.stringify(JSON.parse(data[1]), null, 2)}`}</pre>
          </div>
        </div>
      )}
    </>
  );

  const SignatureDetails = () => (
    <>
      {data.eventName === 'eth_signTypedData' &&
        data[0].map((item: any, number: number) => (
          <div
            key={number}
            className="flex flex-row justify-between mb-2 w-full font-poppins text-xs text-white"
          >
            <p>{item?.name}</p>
            <p>{item?.value}</p>
          </div>
        ))}
    </>
  );

  return (
    <Layout canGoBack={false} title={t('transactions.signatureRequest')}>
      <ErrorModal
        show={Boolean(errorMsg)}
        onClose={window.close}
        title={t('transactions.signatureFailed')}
        description={t('transactions.sorryWeCould')}
        log={errorMsg || '...'}
        buttonText="Ok"
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

      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
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

          <div className="flex flex-col pb-4 w-full">
            <p className="font-poppins text-center text-xs overflow-auto">
              {message}
            </p>
          </div>

          {(data.eventName === 'personal_sign' ||
            data.eventName === 'eth_sign') && (
            <div className="flex flex-col w-full">
              {data.eventName === 'eth_sign' && (
                <p className="mb-4 w-full text-center text-red-600 font-poppins text-xs">
                  {warningMessage}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col ">
            <div className="flex flex-row ml-[1.5rem] gap-3 items-center">
              {tabLabel?.map((tabLabel, index) => (
                <div
                  key={index}
                  onClick={() => setState(tabLabel)}
                  className={` ${
                    tabLabel === state
                      ? 'bg-brand-blue600'
                      : 'bg-alpha-whiteAlpha200'
                  } rounded-t-[20px] py-[8px] px-[16px] h-[40px] w-[92px] text-base font-normal cursor-pointer hover:opacity-60 text-center`}
                >
                  {tabLabel}
                </div>
              ))}
            </div>
            <div className="bg-brand-blue600 w-[396px] relative left-[0%] flex flex-col items-center justify-center p-6 rounded-[20px]">
              {state === 'Details' ? (
                <>
                  <AccountDetailsSignature />
                  <SignatureDetails />
                </>
              ) : (
                <DataSignature />
              )}
            </div>
          </div>

          <div
            className={` ${
              state === 'Details' ? 'mt-12' : 'my-8'
            } gap-6 flex items-center justify-between w-full md:max-w-2xl`}
          >
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
              className="xl:p-18 h-[40px] w-[164px] flex items-center justify-center text-brand-blue400 text-base bg-white hover:opacity-60 rounded-[100px] transition-all duration-300"
            >
              {t('buttons.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default EthSign;
