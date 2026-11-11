import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { AccountIdenticon } from 'components/AccountIdenticon';
import { Button, Icon, PageActionFooter, Tooltip } from 'components/index';
import { getAccountReviewTokens, TokenIconStack } from 'components/TokenIcon';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import store, { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountRef,
  selectAccountAssets,
} from 'state/vault/selectors';
import { KeyringAccountType } from 'types/network';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';
import { canPublishAccountAddress } from 'utils/smartAccount/addressIdentity';

export const ChangeConnectedAccount = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const activeAccountRef = useSelector(selectActiveAccountRef);
  const activeAccount = useSelector(selectActiveAccount);
  const { accounts, activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const accountAssets = useSelector(selectAccountAssets);
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();
  const { host, eventName, connectedAccount, accountType } = useQueryData();
  const [isChanging, setIsChanging] = useState(false);
  const [switchError, setSwitchError] = useState('');
  // The popup query contains only the public ID, address and label. Resolve
  // smart-account metadata from the vault, never from the popup URL.
  const resolveSmartAccount = (
    currentAccounts: RootState['vault']['accounts'],
    currentNetwork: RootState['vault']['activeNetwork']
  ) => {
    const current =
      currentAccounts?.[KeyringAccountType.SmartAccount]?.[
        connectedAccount?.id
      ];
    return current &&
      current.address === connectedAccount?.address &&
      isAccountCompatibleWithNetwork(current, accountType, currentNetwork) &&
      canPublishAccountAddress(current, accountType, currentNetwork.chainId)
      ? current
      : undefined;
  };
  const isSmartAccount = accountType === KeyringAccountType.SmartAccount;
  const verifiedAccount = isSmartAccount
    ? resolveSmartAccount(accounts, activeNetwork)
    : undefined;
  const requiredAccount = isSmartAccount
    ? verifiedAccount || {
        id: connectedAccount?.id,
        label: connectedAccount?.label,
      }
    : connectedAccount;
  const canSwitchAccount = isSmartAccount
    ? Boolean(verifiedAccount)
    : Boolean(connectedAccount);

  const handleAccept = async () => {
    if (!canSwitchAccount) return;
    if (isSmartAccount) {
      const { accounts: currentAccounts, activeNetwork: currentNetwork } =
        store.getState().vault;
      if (!resolveSmartAccount(currentAccounts, currentNetwork)) {
        setSwitchError(t('receive.addressUnavailable'));
        return;
      }
    }
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
  const connectedAccountTokens =
    isSmartAccount && !verifiedAccount
      ? []
      : getAccountReviewTokens(
          accountAssets,
          isBitcoinBased,
          requiredAccount,
          accountType
        );
  const activeAccountTokens = getAccountReviewTokens(
    accountAssets,
    isBitcoinBased,
    activeAccount,
    activeAccountRef.type
  );

  const renderAccountCard = (
    account: any,
    type: string,
    tokens: any[],
    required = false
  ) => {
    const label = account?.label;
    const address = canPublishAccountAddress(
      account,
      type,
      activeNetwork?.chainId
    )
      ? account?.address
      : undefined;
    return (
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider">
          {required
            ? t('connections.requiredAccount')
            : t('connections.currentActiveAccount')}
        </h4>
        <div
          className={`w-full p-4 rounded-lg border ${
            required ? 'border-brand-orange' : 'border-brand-royalblue'
          } bg-bkg-2`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-3 flex-1 basis-44 min-w-0">
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
                {address ? (
                  <div className="flex items-center gap-1">
                    <Tooltip content={address} placement="top">
                      <p className="text-xs text-brand-graylight">
                        {ellipsis(address, 8, 4)}
                      </p>
                    </Tooltip>
                    <div className="inline-flex flex-shrink-0 items-center">
                      <button
                        aria-label={t('buttons.copy')}
                        onClick={async () => {
                          try {
                            await copy(address);
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
                ) : (
                  <p className="text-xs text-brand-graylight">
                    {t('receive.addressUnavailable')}
                  </p>
                )}
              </div>
            </div>
            {/* Only display balances and assets for the verified identity. */}
            {address && (
              <div className="ml-auto flex items-center justify-end gap-3 flex-shrink-0 min-w-[80px] min-h-10">
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
                      <TokenIconStack
                        tokens={tokens}
                        chainId={activeNetwork.chainId}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
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
            <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
              <Icon name="warning" className="text-white" size={16} />
            </div>
            <p className="min-w-0 [overflow-wrap:anywhere] text-lg font-medium text-brand-white">
              {host}
            </p>
          </div>
          <p className="text-xs text-brand-graylight mt-2">
            {t('connections.dappRequiresAccount')}
          </p>
        </div>

        {/* Account comparison */}
        <div className="px-6 py-6 space-y-4">
          {renderAccountCard(
            requiredAccount,
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
            disabled={isChanging || !canSwitchAccount}
          >
            {t('connections.switchAccount')}
          </Button>
        </div>
      </PageActionFooter>
    </div>
  );
};
