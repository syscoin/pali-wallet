import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LockFilled } from 'components/Icon/Icon';
import { LoadingSvg } from 'components/Icon/Icon';
import { Icon, IconButton, Tooltip } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';

import { EncryptionReview } from './EncryptionReview';

interface ISign {
  send?: boolean;
}

const Decrypt: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    message: string;
    scope: string;
  } | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount =
    accounts[activeAccountMeta.type]?.[activeAccountMeta.id];
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const previewScope = JSON.stringify([
    activeAccountMeta.type,
    activeAccountMeta.id,
    activeAccount?.address,
    isBitcoinBased,
    activeNetwork?.chainId,
    activeNetwork?.url,
    host,
    data.eventName,
    data[0],
    data[1],
  ]);
  const currentPreviewScope = useRef(previewScope);
  currentPreviewScope.current = previewScope;
  const previewRequest = useRef(0);
  const copyRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewRequest.current += 1;
      copyRequest.current += 1;
    };
  }, []);
  useEffect(() => {
    previewRequest.current += 1;
    copyRequest.current += 1;
    setPreview(null);
    setErrorMsg(null);
    setIsDecrypting(false);
  }, [previewScope]);
  // Do not show the old plaintext even during the render before effect cleanup.
  const decryptedMessage =
    preview?.scope === previewScope ? preview.message : null;

  const copyValue = async (value: string, message: string) => {
    if (!mounted.current || currentPreviewScope.current !== previewScope)
      return;
    const request = ++copyRequest.current;
    const isCurrent = () =>
      mounted.current &&
      currentPreviewScope.current === previewScope &&
      copyRequest.current === request;
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent()) alert.info(t(message));
    } catch {
      if (isCurrent()) alert.error(t('transactions.copyFailed'));
    }
  };

  // Handle missing account
  if (!activeAccount) {
    console.error('Active account not found:', activeAccountMeta);
    return (
      <div className="flex flex-col items-center justify-center h-full p-4">
        <p className="text-red-500">{t('settings.activeAccountNotFound')}</p>
      </div>
    );
  }

  const { address } = activeAccount;

  const getDecryptParams = () => {
    if (
      typeof data[1] !== 'string' ||
      data[1].toLowerCase() !== address.toLowerCase()
    )
      throw Object.assign(new Error('Requested account is not active'), {
        code: 'PALI_REQUESTED_ACCOUNT_NOT_ACTIVE',
      });
    return [data[0], data[1]];
  };

  const handleDecrypt = async () => {
    if (!mounted.current || currentPreviewScope.current !== previewScope)
      return;
    const request = ++previewRequest.current;
    const isCurrent = () =>
      mounted.current &&
      currentPreviewScope.current === previewScope &&
      previewRequest.current === request;
    setErrorMsg(null);
    if (isBitcoinBased) {
      setErrorMsg(t('transactions.decryptionUnavailableUtxo'));
      return;
    }

    // Validate address
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      setErrorMsg(
        t('transactions.invalidActiveAddress', {
          address,
          interpolation: { escapeValue: false },
        })
      );
      return;
    }

    setIsDecrypting(true);
    try {
      const decrypted = await controllerEmitter(
        ['wallet', 'ethereumTransaction', 'decryptMessage'],
        [getDecryptParams()]
      );
      if (isCurrent())
        setPreview({ message: decrypted as string, scope: previewScope });
    } catch (error: any) {
      if (isCurrent())
        setErrorMsg(
          error.code === 'PALI_REQUESTED_ACCOUNT_NOT_ACTIVE'
            ? t('transactions.requestedAccountNotActive')
            : error.message || t('transactions.decryptFailed')
        );
    } finally {
      if (isCurrent()) setIsDecrypting(false);
    }
  };

  const onSubmit = async () => {
    if (!mounted.current || currentPreviewScope.current !== previewScope)
      return;
    setLoading(true);
    const type = data.eventName;

    // Safety check: decryption is only for EVM networks
    if (isBitcoinBased) {
      setErrorMsg(t('transactions.decryptionUnavailableUtxo'));
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
        [getDecryptParams()]
      );

      dispatchBackgroundEvent(`${type}.${host}`, response);
      if (!mounted.current) return;
      setConfirmed(true);

      setLoading(false);
      window.close();
    } catch (error: any) {
      if (!mounted.current) return;
      setErrorMsg(
        error.code === 'PALI_REQUESTED_ACCOUNT_NOT_ACTIVE'
          ? t('transactions.requestedAccountNotActive')
          : error.message || t('transactions.decryptFailed')
      );
      setLoading(false);
    }
  };

  return (
    <EncryptionReview
      account={activeAccount}
      confirmed={confirmed}
      description={t('transactions.wouldLikeTo')}
      errorMsg={errorMsg}
      host={host}
      loading={loading}
      onCopy={() => void copyValue(address, 'home.addressCopied')}
      onSubmit={onSubmit}
      title={t('send.decrypt')}
    >
      {/* Encrypted message section */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-brand-white mb-2">
          {t('transactions.message')}:
        </h4>
        {decryptedMessage === null ? (
          <button
            type="button"
            aria-label={t('transactions.decryptMessage')}
            aria-busy={isDecrypting}
            disabled={isDecrypting}
            className="w-full min-w-0 bg-bkg-1 rounded-lg p-4 cursor-pointer text-left hover:bg-bkg-2 disabled:cursor-wait focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue transition-colors"
            onClick={handleDecrypt}
          >
            <span className="flex items-center justify-between gap-4">
              <span className="min-w-0 text-xs text-brand-graylight/50 break-all font-mono flex-1">
                {/* Display truncated encrypted data */}
                {typeof data[0] === 'string' && data[0].length > 100
                  ? `${data[0].substring(0, 50)}...${data[0].substring(
                      data[0].length - 50
                    )}`
                  : data[0]}
              </span>
              <span className="flex flex-col items-center gap-1 flex-shrink-0">
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
              </span>
            </span>
          </button>
        ) : (
          <div className="bg-bkg-1 rounded-lg p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm text-brand-white whitespace-pre-wrap [overflow-wrap:anywhere] flex-1">
                {decryptedMessage}
              </p>
              <Tooltip content={t('buttons.copy')}>
                <IconButton
                  aria-label={t('transactions.copyMessage')}
                  onClick={() =>
                    void copyValue(
                      decryptedMessage ?? '',
                      'transactions.messageCopied'
                    )
                  }
                  className="min-h-11 min-w-11 flex-shrink-0 p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue"
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
    </EncryptionReview>
  );
};

export default Decrypt;
