import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  DefaultModal,
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { getNetworkChain } from 'utils/network';

interface ISign {
  send?: boolean;
}
const EthSign: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
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
  const url = chrome.runtime.getURL('app.html');
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    ({ vault }: RootState) => vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const activeNetwork = useSelector(
    ({ vault }: RootState) => vault.activeNetwork
  );
  const { isBitcoinBased } = useSelector(({ vault }: RootState) => vault);
  const { label, balances, address } = activeAccount;
  const { currency } = activeNetwork;

  const warningMessage = t('transactions.warningSignMessage');

  const onSubmit = async () => {
    setLoading(true);

    // Safety check: signing is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg('Message signing is not available on UTXO networks');
      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
      return;
    }

    try {
      let response = '';
      const type = data.eventName;
      if (data.eventName === 'eth_sign')
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'ethSign'],
          [data]
        )) as string;
      else if (data.eventName === 'personal_sign')
        response = (await controllerEmitter(
          ['wallet', 'ethereumTransaction', 'signPersonalMessage'],
          [data]
        )) as string;
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
          response = (await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'signTypedData'],
            [address, typedData, 'V1']
          )) as string;
        } else if (data.eventName === 'eth_signTypedData_v3') {
          response = (await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'signTypedData'],
            [address, typedData, 'V3']
          )) as string;
        } else if (data.eventName === 'eth_signTypedData_v4') {
          response = (await controllerEmitter(
            ['wallet', 'ethereumTransaction', 'signTypedData'],
            [address, typedData, 'V4']
          )) as string;
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

      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
    }
  };
  useEffect(() => {
    // Safety check: ETH signing is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg('ETH signing is not available on UTXO networks');
      return;
    }

    if (data.eventName === 'personal_sign') {
      const msg = data[0] === activeAccount.address ? data[1] : data[0];

      controllerEmitter(
        ['wallet', 'ethereumTransaction', 'parsePersonalMessage'],
        [msg]
      ).then((res: string) => {
        setMessage(res);
      });
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
          <p>{balances[getNetworkChain(isBitcoinBased)]}</p>
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
    <>
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
              {tabLabel?.map((name, index) => (
                <div
                  key={index}
                  onClick={() => setState(name)}
                  className={` ${
                    name === state
                      ? 'bg-brand-blue600'
                      : 'bg-alpha-whiteAlpha200'
                  } rounded-t-[20px] py-[8px] px-[16px] h-[40px] w-[92px] text-base font-normal cursor-pointer hover:opacity-60 text-center`}
                >
                  {name}
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

export default EthSign;
