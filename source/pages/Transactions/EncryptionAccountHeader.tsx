import { toSvg } from 'jdenticon';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { LazyAccountBalance } from 'components/AccountBalance';
import { Icon, Tooltip } from 'components/index';
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

export const EncryptionAccountHeader = ({
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
