import { toSvg } from 'jdenticon';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { LockIconSvg } from 'components/Icon/Icon';
import { Button, Icon, Tooltip } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
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
        className="rounded-full shrink-0 overflow-hidden transition-all duration-200 hover:scale-105 hover:opacity-80"
        style={{ width: size, height: size }}
      />
    );
  }
);
AccountIcon.displayName = 'AccountIcon';

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
  const { label, address } = activeAccount;
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
    setLoading(true);
    const type = data.eventName;
    try {
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
        <div className="bg-bkg-2 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <AccountIcon account={activeAccount} size={48} />
            <div className="min-w-0 flex-1 basis-40">
              <div className="flex items-center gap-2">
                <p className="min-w-0 break-words [overflow-wrap:anywhere] text-lg font-medium text-brand-white">
                  {label}
                </p>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Tooltip content={address} placement="top">
                  <p className="text-sm text-brand-graylight">
                    {ellipsis(address, 8, 6)}
                  </p>
                </Tooltip>
                <button
                  type="button"
                  aria-label={t('transactions.copyAddress')}
                  onClick={() => void copyAddress()}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full hover:bg-brand-blue800 hover:text-brand-royalblue focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-royalblue transition-colors duration-200"
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
            <div className="ml-auto min-w-0 max-w-full text-right">
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
