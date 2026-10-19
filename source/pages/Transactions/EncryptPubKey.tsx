import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LockIconSvg } from 'components/Icon/Icon';
import { Button } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';

import { EncryptionAccountHeader } from './EncryptionAccountHeader';

interface ISign {
  send?: boolean;
}

const EncryptPubKey: React.FC<ISign> = () => {
  const { controllerEmitter } = useController();
  const { host, ...data } = useQueryData();
  const { t } = useTranslation();
  const { alert } = useUtils();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const { address } = activeAccount;
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const copyScope = JSON.stringify([
    activeAccountMeta,
    address,
    activeNetwork.kind,
    activeNetwork.chainId,
    activeNetwork.url,
    activeNetwork.apiUrl,
    host,
    data.eventName,
    data[0],
  ]);
  const copyScopeRef = useRef(copyScope);
  copyScopeRef.current = copyScope;
  const copyContext = useRef({ active: true, sequence: 0 });
  useEffect(() => {
    copyContext.current.active = true;
    return () => {
      copyContext.current.active = false;
      copyContext.current.sequence += 1;
    };
  }, [copyScope]);

  const copyAddress = async () => {
    if (!copyContext.current.active || copyScopeRef.current !== copyScope)
      return;
    const sequence = ++copyContext.current.sequence;
    const isCurrent = () =>
      copyContext.current.active &&
      copyScopeRef.current === copyScope &&
      copyContext.current.sequence === sequence;
    try {
      await navigator.clipboard.writeText(address);
      if (isCurrent()) alert.info(t('home.addressCopied'));
    } catch {
      if (isCurrent()) alert.error(t('transactions.copyFailed'));
    }
  };

  const onSubmit = async () => {
    if (!copyContext.current.active || copyScopeRef.current !== copyScope)
      return;
    setLoading(true);
    const type = data.eventName;
    try {
      if (
        typeof data[0] !== 'string' ||
        data[0].toLowerCase() !== address.toLowerCase()
      )
        throw new Error('Requested account is not active');
      const response = await controllerEmitter([
        'wallet',
        'ethereumTransaction',
        'getEncryptedPubKey',
      ]);
      dispatchBackgroundEvent(`${type}.${host}`, response);
      if (!copyContext.current.active) return;
      setConfirmed(true);

      setLoading(false);
      window.close();
    } catch (error: any) {
      if (!copyContext.current.active) return;
      setErrorMsg(error.message || 'Failed to get encryption key');
      setLoading(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        {/* Account section */}
        <EncryptionAccountHeader
          account={activeAccount}
          onCopy={() => void copyAddress()}
        />

        {/* Request info section */}
        <div className="px-6 pb-24">
          <div className="bg-bkg-1 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <LockIconSvg className="text-brand-royalblue mt-0.5 w-5 h-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium text-brand-white mb-2">
                  {t('send.encryptKey')}
                </h3>
                <p className="break-words [overflow-wrap:anywhere] text-sm text-brand-graylight">
                  {host} {t('transactions.wouldLikeYourPubEncryption')}
                </p>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-500">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>

      {/* Fixed button container at bottom */}
      <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            type="button"
            disabled={loading}
            onClick={window.close}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            variant="primary"
            type="submit"
            disabled={confirmed}
            loading={loading}
            onClick={onSubmit}
          >
            {t('buttons.confirm')}
          </Button>
        </div>
      </ToastActionFooter>
    </div>
  );
};

export default EncryptPubKey;
