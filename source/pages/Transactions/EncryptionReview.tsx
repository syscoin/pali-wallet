import { toSvg } from 'jdenticon';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { LazyAccountBalance } from 'components/AccountBalance';
import { LockIconSvg } from 'components/Icon/Icon';
import { Button, Icon, Tooltip } from 'components/index';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { IKeyringAccountState } from 'types/network';
import { ellipsis } from 'utils/index';

const AccountIcon = React.memo(
  ({ account }: { account: IKeyringAccountState }) => {
    const iconRef = useRef<HTMLDivElement>(null);
    const identifier = account.xpub || account.address || '';

    useEffect(() => {
      if (!iconRef.current || !identifier) return;
      iconRef.current.innerHTML = toSvg(identifier, 48, {
        backColor: '#07152B',
        padding: 1,
      });
    }, [identifier]);

    return (
      <div
        ref={iconRef}
        className="rounded-full shrink-0 overflow-hidden transition-all duration-200 hover:scale-105 hover:opacity-80"
        style={{ width: 48, height: 48 }}
      />
    );
  }
);
AccountIcon.displayName = 'AccountIcon';

const EncryptionAccountHeader = ({
  account,
  onCopy,
}: {
  account: IKeyringAccountState;
  onCopy: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="bg-bkg-2 p-4 mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <AccountIcon account={account} />
        <div className="min-w-0 flex-1 basis-40">
          <div className="flex items-center gap-2">
            <p className="min-w-0 break-words [overflow-wrap:anywhere] text-lg font-medium text-brand-white">
              {account.label}
            </p>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <Tooltip content={account.address} placement="top">
              <p className="text-sm text-brand-graylight">
                {ellipsis(account.address, 8, 6)}
              </p>
            </Tooltip>
            <button
              type="button"
              aria-label={t('transactions.copyAddress')}
              onClick={onCopy}
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
            account={account}
            showFiat={true}
            showSkeleton={true}
            precision={8}
          />
        </div>
      </div>
    </div>
  );
};

export const EncryptionReview = ({
  account,
  children,
  confirmed,
  description,
  errorMsg,
  host,
  loading,
  onCopy,
  onSubmit,
  title,
}: {
  account: IKeyringAccountState;
  children?: React.ReactNode;
  confirmed: boolean;
  description: string;
  errorMsg: string | null;
  host: string;
  loading: boolean;
  onCopy: () => void;
  onSubmit: () => void;
  title: string;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col h-full">
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        <EncryptionAccountHeader account={account} onCopy={onCopy} />
        <div className="px-6 pb-24">
          <div className="bg-bkg-1 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <LockIconSvg className="text-brand-royalblue mt-0.5 w-5 h-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-medium text-brand-white mb-2">
                  {title}
                </h3>
                <p className="break-words [overflow-wrap:anywhere] text-sm text-brand-graylight">
                  {host} {description}
                </p>
              </div>
            </div>
          </div>
          {children}
          {errorMsg && (
            <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm text-red-500">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>
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
