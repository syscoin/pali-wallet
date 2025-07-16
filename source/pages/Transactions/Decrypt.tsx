import { LockFilled } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  ErrorModal,
  Icon,
  IconButton,
  PrimaryButton,
  SecondaryButton,
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
const Decrypt: React.FC<ISign> = () => {
  const { host, ...data } = useQueryData();
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [decryptedMessage, setDecryptedMessage] = useState('');
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const { controllerEmitter } = useController();
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const { label, balances, address } = activeAccount;
  const { currency } = activeNetwork;
  const { t } = useTranslation();
  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.info(t('transactions.messageCopied'));
  }, [copied, alert, t]);

  const onSubmit = async () => {
    setLoading(true);
    const type = data.eventName;

    // Safety check: decryption is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg('Message decryption is not available on UTXO networks');
      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
      setLoading(false);
      return;
    }

    if (data[1] !== address) {
      setErrorMsg('Asking for key of non connected account');
      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
      setLoading(false);
      return;
    }
    try {
      const response = await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'decryptMessage'],
        [data]
      );

      dispatchBackgroundEvent(`${type}.${host}`, response);
      setConfirmed(true);

      setLoading(false);

      window.close();
    } catch (error) {
      setErrorMsg(error.message);

      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
      setLoading(false);
    }
  };

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
      {!loading && (
        <div className="flex flex-col items-center justify-center w-full">
          <div className="flex flex-row justify-between mb-16 w-full">
            <p className="font-poppins text-sm">
              {t('transactions.account')}: {label}
            </p>
            <p className="font-poppins text-sm">
              {t('send.balance')}: {balances[getNetworkChain(isBitcoinBased)]}{' '}
              {currency.toUpperCase()}
            </p>
          </div>
          <div className="flex flex-col pb-4 pt-4 w-full border-b border-t border-dashed border-dashed-dark">
            <div className="scrollbar-styled h-fit mt-1 px-4 w-full text-center text-xs overflow-auto">
              <span>
                {host} {t('transactions.wouldLikeTo')}
              </span>
            </div>

            {!decryptedMessage && (
              <div
                className="h-fit align-center justify-center mt-1 px-4 w-full text-xs cursor-pointer"
                onClick={() => {
                  // Safety check: decryption is only for EVM networks
                  if (isBitcoinBased) {
                    setErrorMsg(
                      'Message decryption is not available on UTXO networks'
                    );
                    return;
                  }

                  controllerEmitter(
                    ['wallet', 'ethereumTransaction', 'decryptMessage'],
                    [data]
                  ).then(setDecryptedMessage);
                }}
              >
                <span className="w-full break-words opacity-20">{data[0]}</span>
                <div className="align-center w-fit absolute right-36 top-72 flex flex-col justify-center text-center">
                  <LockFilled className="text-lg" />
                  <span className="text-center">
                    {t('transactions.decryptMessage')}
                  </span>
                </div>
              </div>
            )}

            {decryptedMessage && (
              <div className="flex flex-col w-full">
                <h1 className="text-lg">{t('transactions.message')}:</h1>
                <p className="scrollbar-styled font-poppins text-sm overflow-auto">
                  {decryptedMessage}{' '}
                  <IconButton onClick={() => copy(decryptedMessage ?? '')}>
                    <Icon
                      name="copy"
                      className="relative bottom-0.5 px-1 text-brand-white hover:text-fields-input-borderfocus"
                    />
                  </IconButton>
                </p>
              </div>
            )}
          </div>

          <div className="w-full px-4 absolute bottom-12 md:static flex items-center justify-between">
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

export default Decrypt;
