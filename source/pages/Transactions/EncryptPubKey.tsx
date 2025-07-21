import { toSvg } from 'jdenticon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { LockIconSvg } from 'components/Icon/Icon';
import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  Tooltip,
} from 'components/index';
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
        className="rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80"
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
  const { useCopyClipboard, alert } = useUtils();
  const [copied, copyText] = useCopyClipboard();
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const { label, address } = activeAccount;

  React.useEffect(() => {
    if (!copied) return;
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

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
      setConfirmed(true);

      setLoading(false);
      window.close();
    } catch (error: any) {
      setErrorMsg(error.message || 'Failed to get encryption key');
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
                  {t('send.encryptKey')}
                </h3>
                <p className="text-sm text-brand-graylight">
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

export default EncryptPubKey;
