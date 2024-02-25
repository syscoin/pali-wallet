import { LockFilled } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  ErrorModal,
  Icon,
  IconButton,
  Layout,
  PrimaryButton,
  SecondaryButton,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';

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
  const { ethereumTransaction } = getController().wallet;
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

    alert.removeAll();
    alert.success(t('transactions.messageCopied'));
  }, [copied]);

  const onSubmit = async () => {
    setLoading(true);
    const type = data.eventName;
    if (data[1] !== address) {
      const response = {
        code: 4001,
        message: 'Pali: Asking for key of non connected account',
      };
      dispatchBackgroundEvent(`${type}.${host}`, response);
      window.close();
    }
    try {
      const response = await ethereumTransaction.decryptMessage(data);
      setConfirmed(true);
      setLoading(false);
      dispatchBackgroundEvent(`${type}.${host}`, response);
      window.close();
    } catch (error) {
      setErrorMsg(error.message);

      setTimeout(window.close, 40000);
    }
  };

  return (
    <Layout canGoBack={false} title={t('transactions.decryptRequest')}>
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
              {t('send.balance')}:{' '}
              {balances[isBitcoinBased ? 'syscoin' : 'ethereum']}{' '}
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
                onClick={() =>
                  setDecryptedMessage(ethereumTransaction.decryptMessage(data))
                }
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

export default Decrypt;
