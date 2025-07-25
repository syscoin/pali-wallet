import { LockFilled } from '@ant-design/icons';
import { toSvg } from 'jdenticon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { LoadingSvg, LockIconSvg } from 'components/Icon/Icon';
import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  IconButton,
  Tooltip,
} from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';

interface ISign {
  send?: boolean;
}

// Account icon component
const AccountIcon = React.memo(
  ({ account, size = 48 }: { account: any; size?: number }) => {
    const iconRef = React.useRef<HTMLDivElement>(null);
    const identifier = account?.xpub || account?.address || '';

    React.useEffect(() => {
      if (!iconRef.current || !identifier) return;
      iconRef.current.innerHTML = toSvg(identifier, size, {
        backColor: '#07152B',
        padding: 1,
      });
    }, [identifier, size]);

    return (
      <div
        ref={iconRef}
        className="rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80"
        style={{ width: size, height: size }}
      />
    );
  }
);
AccountIcon.displayName = 'AccountIcon';

const Decrypt: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const { useCopyClipboard, alert } = useUtils();
  const [copied, copyText] = useCopyClipboard();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [decryptedMessage, setDecryptedMessage] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount =
    accounts[activeAccountMeta.type]?.[activeAccountMeta.id];
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);

  // All hooks must be called before any conditional returns
  React.useEffect(() => {
    if (!copied) return;
    alert.info(t('transactions.messageCopied'));
  }, [copied, alert, t]);

  // Handle missing account
  if (!activeAccount) {
    console.error('Active account not found:', activeAccountMeta);
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <p className="text-red-500">{t('settings.activeAccountNotFound')}</p>
      </div>
    );
  }

  const { label, address } = activeAccount;

  const handleDecrypt = async () => {
    if (isBitcoinBased) {
      setErrorMsg('Message decryption is not available on UTXO networks');
      return;
    }

    // Validate address
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      setErrorMsg(`Invalid active account address: ${address}`);
      return;
    }

    setIsDecrypting(true);
    try {
      // Pass only the required parameters: [encryptedData, address]
      const decryptParams = [data[0], address];

      const decrypted = await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'decryptMessage'],
        [decryptParams]
      );
      setDecryptedMessage(decrypted as string);
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to decrypt message');
    } finally {
      setIsDecrypting(false);
    }
  };

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

    try {
      // Pass only the required parameters: [encryptedData, address]
      const decryptParams = [data[0], address];

      const response = await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'decryptMessage'],
        [decryptParams]
      );

      dispatchBackgroundEvent(`${type}.${host}`, response);
      setConfirmed(true);

      setLoading(false);
      window.close();
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to decrypt message');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        {/* Account section */}
        <div className="bg-bkg-2 p-4 mb-4">
          <div className="flex items-center gap-4">
            <AccountIcon account={activeAccount} size={48} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-lg font-medium text-brand-white">{label}</p>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Tooltip content={address} placement="top">
                  <p className="text-sm text-brand-graylight">
                    {ellipsis(address, 8, 6)}
                  </p>
                </Tooltip>
                <button
                  onClick={() => {
                    copyText(address);
                    alert.info(t('home.addressCopied'));
                  }}
                  className="hover:text-brand-royalblue transition-colors duration-200"
                >
                  <Icon
                    name="copy"
                    className="text-xs"
                    size={10}
                    wrapperClassname="h-[1em] flex items-center"
                  />
                </button>
              </div>
            </div>
            <div className="text-right">
              <LazyAccountBalance
                account={activeAccount}
                showFiat={true}
                showSkeleton={true}
                precision={8}
              />
            </div>
          </div>
        </div>

        {/* Request info section */}
        <div className="px-6 pb-24">
          <div className="bg-bkg-1 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <LockIconSvg className="text-brand-royalblue mt-0.5 w-5 h-5" />
              <div className="flex-1">
                <h3 className="text-base font-medium text-brand-white mb-2">
                  {t('send.decrypt')}
                </h3>
                <p className="text-sm text-brand-graylight">
                  {host} {t('transactions.wouldLikeTo')}
                </p>
              </div>
            </div>
          </div>

          {/* Encrypted message section */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-brand-white mb-2">
              {t('transactions.message')}:
            </h4>
            {!decryptedMessage ? (
              <div
                className="bg-bkg-1 rounded-lg p-4 cursor-pointer hover:bg-bkg-2 transition-colors"
                onClick={handleDecrypt}
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-brand-graylight/50 break-all font-mono flex-1">
                    {/* Display truncated encrypted data */}
                    {typeof data[0] === 'string' && data[0].length > 100
                      ? `${data[0].substring(0, 50)}...${data[0].substring(
                          data[0].length - 50
                        )}`
                      : data[0]}
                  </p>
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    {isDecrypting ? (
                      <LoadingSvg className="w-5 h-5 text-brand-royalblue animate-spin" />
                    ) : (
                      <>
                        <LockFilled className="text-lg text-brand-royalblue" />
                        <span className="text-xs text-brand-royalblue whitespace-nowrap">
                          {t('transactions.decryptMessage')}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-bkg-1 rounded-lg p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-brand-white break-all flex-1">
                    {decryptedMessage}
                  </p>
                  <Tooltip content={t('buttons.copy')}>
                    <IconButton
                      onClick={() => copyText(decryptedMessage ?? '')}
                      className="flex-shrink-0 p-1"
                    >
                      <Icon
                        name="copy"
                        className="text-brand-white hover:text-fields-input-borderfocus"
                        size={12}
                        wrapperClassname="flex items-center justify-center"
                      />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-500">{errorMsg}</p>
            </div>
          )}
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
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};

export default Decrypt;
