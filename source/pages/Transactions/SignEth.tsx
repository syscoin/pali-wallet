import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  DefaultModal,
  ErrorModal,
  PrimaryButton,
  SecondaryButton,
  IconButton,
  Icon,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
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
  const { useCopyClipboard, alert } = useUtils();
  const [copied, copy] = useCopyClipboard();
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

  // Get the action type for better UX messaging
  const getActionType = () => {
    switch (data.eventName) {
      case 'eth_sign':
        return t('send.signMessage');
      case 'personal_sign':
        return t('send.signPersonalMessage');
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        return t('send.signTypedData');
      default:
        return t('send.signMessage');
    }
  };

  const getMessageDescription = () => {
    switch (data.eventName) {
      case 'eth_sign':
        return t('send.signingMessage');
      case 'personal_sign':
        return t('send.signingPersonalMessage');
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4':
        return t('send.signingStructuredData');
      default:
        return t('send.signingGeneral');
    }
  };

  const onSubmit = async () => {
    setLoading(true);

    // Safety check: signing is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg(t('send.messageSigningNotAvailable'));
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
          throw { message: t('send.signingForWrongAddress') };
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
      setErrorMsg(t('send.ethSigningNotAvailable'));
      return;
    }

    if (data.eventName === 'personal_sign') {
      const msg = data[0] === activeAccount.address ? data[1] : data[0];

      // Check if the message is hex encoded UTF-8 text or just a string starting with 0x
      if (msg.startsWith('0x') && msg.length > 2) {
        // Try to parse as hex, but only if it's likely to be encoded text
        // Ethereum addresses are 42 characters (0x + 40 hex), so skip those
        if (msg.length === 42) {
          // This is likely an Ethereum address, show as-is
          setMessage(msg);
        } else {
          // This might be hex-encoded text, try to parse it
          controllerEmitter(
            ['wallet', 'ethereumTransaction', 'parsePersonalMessage'],
            [msg]
          )
            .then((res: string) => {
              // Only use parsed result if it contains readable text
              if (res && /^[\x20-\x7E\s]*$/.test(res)) {
                setMessage(res);
              } else {
                // Parsed result is not readable text, show original
                setMessage(msg);
              }
            })
            .catch(() => {
              // If parsing fails, show the original message
              setMessage(msg);
            });
        }
      } else {
        // Message is plain text, show it directly
        setMessage(msg);
      }
    }

    if (data.eventName === 'eth_sign') {
      // eth_sign parameters should be [address, message]
      let messageToSign = '';

      if (data[0] === activeAccount.address) {
        // Correct order: [address, message]
        messageToSign = data[1];
      } else if (data[1] === activeAccount.address) {
        // Reversed order: [message, address] - fix it
        messageToSign = data[0];
      } else {
        // Neither parameter matches current address
        // For your case: params = ['Hello World!', '0x']
        // Since neither matches address, show the first parameter as message
        messageToSign = data[0] || t('send.invalidParameters');
      }

      // Validate that the message is a proper 32-byte hex string for eth_sign
      const cleanMsg = messageToSign.startsWith('0x')
        ? messageToSign.slice(2)
        : messageToSign;

      if (cleanMsg.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanMsg)) {
        // Message is not a proper hash - show warning
        setErrorMsg(t('send.invalidEthSignFormat', { message: messageToSign }));
        return;
      }

      setMessage(messageToSign);
    }
  }, []);

  useEffect(() => {
    if (copied) {
      alert.info(t('transactions.messageCopied'));
    }
  }, [copied, alert, t]);

  const AccountDetailsSignature = () => (
    <div className="space-y-3">
      <div className="flex flex-row justify-between w-full font-poppins text-sm text-white">
        <span className="text-gray-300">{t('transactions.account')}</span>
        <span className="font-medium">{label}</span>
      </div>
      <div className="flex flex-row justify-between w-full font-poppins text-sm text-white">
        <span className="text-gray-300">{t('send.balance')}</span>
        <div className="flex gap-1">
          <span className="font-medium">
            {balances[getNetworkChain(isBitcoinBased)]}
          </span>
          <span className="text-brand-blue200">{currency.toUpperCase()}</span>
        </div>
      </div>
      <div className="flex flex-row justify-between w-full font-poppins text-sm text-white">
        <span className="text-gray-300">{t('transactions.origin')}</span>
        <span className="font-medium break-all">{host}</span>
      </div>
    </div>
  );

  const DataSignature = () => {
    // Extract parameters from data object (filter out non-numeric properties)
    const parameters = Object.keys(data)
      .filter((key) => !isNaN(Number(key)))
      .map((key) => data[key]);

    return (
      <div className="w-full space-y-4">
        {/* Show raw parameters for all signature types */}
        <div className="bg-gray-900 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
              {t('send.rawParameters')}
            </span>
          </div>
          <div className="space-y-2">
            {parameters.map((param: any, index: number) => (
              <div key={index} className="flex flex-col">
                <span className="text-xs text-gray-400">params[{index}]:</span>
                <pre className="text-xs text-gray-300 whitespace-pre-wrap break-all">
                  {typeof param === 'string'
                    ? param
                    : JSON.stringify(param, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* Show interpreted data for typed data signatures */}
        {(data.eventName === 'eth_signTypedData_v3' ||
          data.eventName === 'eth_signTypedData_v4') && (
          <div className="bg-gray-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
                {t('send.structuredData')}
              </span>
            </div>
            <div className="max-h-80 overflow-auto">
              <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                {JSON.stringify(JSON.parse(data[1]), null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Show parameter interpretation for eth_sign and personal_sign */}
        {(data.eventName === 'eth_sign' ||
          data.eventName === 'personal_sign') && (
          <div className="bg-gray-900 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
                {t('send.parameterInterpretation')}
              </span>
            </div>
            <div className="space-y-2 text-xs text-gray-300">
              {data.eventName === 'eth_sign' ? (
                <>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400">
                      {t('send.addressMatch')}
                    </span>
                    {data[0] === activeAccount.address ||
                    data[1] === activeAccount.address ? (
                      <>
                        <svg
                          className="w-4 h-4 text-green-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-green-400 font-medium">
                          {t('send.match')}
                        </span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4 text-red-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-red-400 font-medium">
                          {t('send.mismatch')}
                        </span>
                      </>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-400">
                      {t('send.interpretedMessage')}
                    </span>
                    <span className="font-mono break-all">
                      {data[0] === activeAccount.address
                        ? data[1]
                        : data[1] === activeAccount.address
                        ? data[0]
                        : data[0]}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="text-gray-400">{t('send.expected')}</span>
                    <span>{t('send.expectedFormat')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">
                      {t('send.actualParams')}
                    </span>
                    <span className="font-mono break-all">
                      [{parameters.map((p) => `"${p}"`).join(', ')}]
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">{t('send.address')}</span>
                    <span className="font-mono break-all">
                      {data[0] === activeAccount.address ? data[0] : data[1]}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">{t('send.message')}: </span>
                    <span className="font-mono break-all">
                      {data[0] === activeAccount.address ? data[1] : data[0]}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const SignatureDetails = () => (
    <div className="space-y-3">
      {data.eventName === 'eth_signTypedData' &&
        data[0].map((item: any, number: number) => (
          <div
            key={number}
            className="flex flex-row justify-between w-full font-poppins text-sm text-white"
          >
            <span className="text-gray-300">{item?.name}</span>
            <span className="font-medium break-all">{item?.value}</span>
          </div>
        ))}
    </div>
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
        <div className="flex flex-col w-full h-screen">
          {/* Main scrollable content area */}
          <div className="flex-1 overflow-y-auto pb-20">
            {/* Header Section */}
            <div className="flex flex-col w-full items-center justify-center mb-8 px-6 py-8">
              <div className="w-16 h-16 relative p-4 mb-6 rounded-full bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
                <img
                  className="absolute inset-0 w-full h-full p-4"
                  src="/assets/all_assets/signature.svg"
                  alt="Signature"
                />
              </div>
              <h1 className="text-xl font-semibold text-white mb-2">
                {getActionType()}
              </h1>
              <p className="text-sm text-gray-300 text-center mb-1">
                {getMessageDescription()}
              </p>
              <p className="text-xs text-gray-400 text-center">
                from <span className="font-medium">{host}</span>
              </p>
            </div>

            {/* Message Preview Section */}
            {message && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-300 uppercase tracking-wide">
                      {t('send.message')}
                    </span>
                    <IconButton onClick={() => copy(message)}>
                      <Icon
                        name="copy"
                        className="text-brand-white hover:text-fields-input-borderfocus"
                        size={12}
                      />
                    </IconButton>
                  </div>
                  <div className="max-h-24 overflow-auto">
                    <p className="text-sm text-white font-mono break-all">
                      {message}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Warning Section for eth_sign */}
            {data.eventName === 'eth_sign' && (
              <div className="w-full max-w-md mx-auto mb-6 px-6">
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 mt-0.5 flex-shrink-0">
                      <svg
                        className="w-full h-full text-red-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-red-300 mb-1">
                        {t('send.potentiallyDangerous')}
                      </p>
                      <p className="text-xs text-red-200">
                        {t('send.dangerousSignatureWarning', { host })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs Section */}
            <div className="flex flex-col w-full max-w-md mx-auto mb-8 px-6">
              <div className="flex gap-1 mb-4">
                {tabLabel.map((name, index) => (
                  <button
                    key={index}
                    onClick={() => setState(name)}
                    className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                      name === state
                        ? 'bg-brand-blue600 text-white'
                        : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div className="bg-gray-800 rounded-lg p-4 min-h-[120px]">
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
          </div>

          {/* Fixed button container at bottom */}
          <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
            <div className="flex gap-3 justify-center">
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
        </div>
      )}
    </>
  );
};

export default EthSign;
