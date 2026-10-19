import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { AccountIdenticon } from 'components/AccountIdenticon';
import { Button, Icon, PageActionFooter, Tooltip } from 'components/index';
import { TokenIconStack } from 'components/TokenIcon';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountRef,
  selectAccountAssets,
} from 'state/vault/selectors';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeConnectedAccount = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const activeAccountRef = useSelector(selectActiveAccountRef);
  const activeAccount = useSelector(selectActiveAccount);
  const { isBitcoinBased } = useSelector((state: RootState) => state.vault);
  const accountAssets = useSelector(selectAccountAssets);
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();
  const { host, eventName, connectedAccount, accountType } = useQueryData();
  const [isChanging, setIsChanging] = useState(false);
  const [switchError, setSwitchError] = useState('');

  // Helper function to get tokens for an account
  const getAccountTokens = useCallback(
    (account: any, accType: string) => {
      if (!account) return [];

      const assets = accountAssets[accType]?.[account.id];
      const allAssets = isBitcoinBased ? assets?.syscoin : assets?.ethereum;
      const tokens = Array.isArray(allAssets)
        ? allAssets.filter(
            (asset: any) => asset.contractAddress && asset.balance > 0
          )
        : [];
      return tokens;
    },
    [accountAssets, isBitcoinBased]
  );

  const handleAccept = async () => {
    setSwitchError('');
    setIsChanging(true);
    try {
      await controllerEmitter(
        ['wallet', 'setAccount'],
        [connectedAccount.id, accountType, true, connectedAccount.address]
      );
      // Dispatch event right before closing
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
    } catch (error) {
      console.error('Failed to change account:', error);
      setSwitchError(error?.message || t('send.failed'));
      setIsChanging(false);
    }
  };

  const handleReject = () => {
    window.close();
  };

  // Get tokens for both accounts
  const connectedAccountTokens = getAccountTokens(
    connectedAccount,
    accountType
  );
  const activeAccountTokens = getAccountTokens(
    activeAccount,
    activeAccountRef.type
  );

  const renderAccountCard = (
    account: any,
    type: string,
    tokens: any[],
    required = false
  ) => {
    const label = required ? account.label : account?.label;
    const address = required ? account.address : account?.address;
    return (
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider">
          {required
            ? t('connections.requiredAccount')
            : 'Current Active Account'}
        </h4>
        <div
          className={`w-full p-4 rounded-lg border ${
            required ? 'border-brand-orange' : 'border-brand-royalblue'
          } bg-bkg-2`}
        >
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="relative">
                <AccountIdenticon
                  account={account}
                  size={40}
                  className="add-identicon rounded-full overflow-hidden"
                />
              </div>
              <div className="flex-1 min-w-0 pr-2">
                <p className="font-medium text-sm text-brand-white mb-1 truncate">
                  {label}
                </p>
                <div className="flex items-center gap-1">
                  <Tooltip content={address} placement="top">
                    <p className="text-xs text-brand-graylight">
                      {ellipsis(address, 8, 4)}
                    </p>
                  </Tooltip>
                  <div className="inline-flex flex-shrink-0 items-center">
                    <button
                      onClick={async () => {
                        try {
                          await copy(
                            required ? account.address : account?.address
                          );
                          alert.info(t('home.addressCopied'));
                        } catch {
                          alert.error(t('transactions.copyFailed'));
                        }
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
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right">
                <LazyAccountBalance
                  account={account}
                  accountType={type}
                  showFiat={true}
                  showSkeleton={true}
                  precision={8}
                />
                {tokens && tokens.length > 0 && (
                  <div className="mt-0.5 flex justify-end">
                    <TokenIconStack tokens={tokens} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        {/* Header section */}
        <div className="text-center px-6 py-6 border-b border-brand-gray300">
          <h3 className="text-xs text-brand-graylight uppercase tracking-wider mb-2">
            {t('connections.accountMismatch')}
          </h3>
          <div className="flex items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
              <Icon name="warning" className="text-white" size={16} />
            </div>
            <p className="text-lg font-medium text-brand-white">{host}</p>
          </div>
          <p className="text-xs text-brand-graylight mt-2">
            {t('connections.dappRequiresAccount')}
          </p>
        </div>

        {/* Account comparison */}
        <div className="px-6 py-6 space-y-4">
          {renderAccountCard(
            connectedAccount,
            accountType,
            connectedAccountTokens,
            true
          )}
          {renderAccountCard(
            activeAccount,
            activeAccountRef.type,
            activeAccountTokens
          )}
        </div>
      </div>

      <PageActionFooter
        error={switchError}
        className="break-words border-t border-brand-gray300"
      >
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            type="button"
            onClick={handleReject}
            disabled={isChanging}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            variant="primary"
            type="button"
            onClick={handleAccept}
            loading={isChanging}
            disabled={isChanging}
          >
            {t('connections.switchAccount')}
          </Button>
        </div>
      </PageActionFooter>
    </div>
  );
};
