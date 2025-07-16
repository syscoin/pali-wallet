import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { PrimaryButton, SecondaryButton } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { getNetworkChain } from 'utils/network';

interface ISign {
  send?: boolean;
}
const EncryptPubKey: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null); // Add error message state
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

  const onSubmit = async () => {
    setLoading(true);
    const type = data.eventName;

    if (data.address !== address) {
      setErrorMsg('Asking for key of non connected account');
      createTemporaryAlarm({
        delayInSeconds: 40,
        callback: () => window.close(),
      });
      setLoading(false);
      return;
    }

    const response = await controllerEmitter([
      'wallet',
      'ethereumTransaction',
      'getEncryptedPubKey',
    ]);
    dispatchBackgroundEvent(`${type}.${host}`, response);
    setConfirmed(true);

    setLoading(false);
    window.close();
  };
  return (
    <>
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
            <div className="scrollbar-styled mt-1 px-4 w-full h-14 text-xs overflow-auto">
              <span>
                {host} {t('transactions.wouldLikeYourPubEncryption')}
              </span>
            </div>
          </div>

          {errorMsg && ( // Display error message if it exists
            <div className="text-red-500 text-sm mt-2">{errorMsg}</div>
          )}

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

export default EncryptPubKey;
