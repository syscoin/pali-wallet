import { toSvg } from 'jdenticon';
import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  SecondaryButton,
  PrimaryButton,
  Icon,
  Tooltip,
} from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { usePrice } from 'hooks/usePrice';
import { RootState } from 'state/store';
import {
  selectActiveAccount,
  selectActiveAccountRef,
  selectAccountAssets,
} from 'state/vault/selectors';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis, formatNumber } from 'utils/index';

// Component to render account icon matching the app's pattern
const AccountIcon = React.memo(
  ({ account, size = 40 }: { account: any; size?: number }) => {
    const iconRef = useRef<HTMLDivElement>(null);

    // Extract identifier to avoid object reference issues
    const identifier = account?.xpub || account?.address || '';

    useEffect(() => {
      if (!iconRef.current || !identifier) return;

      iconRef.current.innerHTML = toSvg(identifier, size, {
        backColor: '#07152B',
        padding: 1,
      });
    }, [identifier, size]);

    return (
      <div
        ref={iconRef}
        className="add-identicon rounded-full overflow-hidden"
        style={{ width: size, height: size }}
      />
    );
  }
);
AccountIcon.displayName = 'AccountIcon';

// Component to render overlapping token icons
const TokenIconStack = React.memo(
  ({ tokens, maxVisible = 3 }: { maxVisible?: number; tokens: any[] }) => {
    if (!tokens || tokens.length === 0) return null;

    const getVisualKey = (token: any) => {
      if (token.logo) return `logo:${token.logo}`;
      if (token.symbol) return `symbol:${token.symbol.charAt(0).toUpperCase()}`;
      return `address:${token.contractAddress || token.assetGuid}`;
    };

    const uniqueTokens = tokens.reduce((acc: any[], token: any) => {
      const visualKey = getVisualKey(token);
      const exists = acc.some((t) => getVisualKey(t) === visualKey);
      if (!exists) {
        acc.push(token);
      }
      return acc;
    }, []);

    const sortedTokens = uniqueTokens.sort((a, b) => {
      const aHasLogo = !!a.logo;
      const bHasLogo = !!b.logo;
      if (aHasLogo && !bHasLogo) return -1;
      if (!aHasLogo && bHasLogo) return 1;
      return 0;
    });

    const visibleTokens = sortedTokens.slice(0, maxVisible);
    const remainingCount = uniqueTokens.length - visibleTokens.length;

    return (
      <div className="flex items-center">
        <div className="flex">
          {visibleTokens.map((token, index) => (
            <div
              key={token.contractAddress || token.assetGuid || index}
              className="relative"
              style={{
                marginLeft: index > 0 ? '-8px' : '0',
                zIndex: visibleTokens.length - index,
              }}
            >
              <TokenIcon
                logo={token.logo}
                contractAddress={token.contractAddress}
                assetGuid={token.assetGuid}
                symbol={token.symbol}
                size={16}
                className="border border-bkg-3 rounded-full"
              />
            </div>
          ))}
        </div>
        {remainingCount > 0 && (
          <span className="ml-1 text-[10px] text-brand-royalblue">
            +{remainingCount}
          </span>
        )}
      </div>
    );
  }
);
TokenIconStack.displayName = 'TokenIconStack';

export const ChangeConnectedAccount = () => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const activeAccountRef = useSelector(selectActiveAccountRef);
  const activeAccount = useSelector(selectActiveAccount);
  const { isBitcoinBased, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const accountAssets = useSelector(selectAccountAssets);
  const { getFiatAmount } = usePrice();
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();
  const { host, eventName, connectedAccount, accountType } = useQueryData();

  // Get balance for an account
  const getAccountBalance = useCallback(
    (account: any, accType: string) => {
      if (!account || !account.balances)
        return { balance: '0', fiatValue: '$0.00', tokens: [] };

      const nativeBalance = isBitcoinBased
        ? account.balances?.syscoin || 0
        : account.balances?.ethereum || 0;

      const formattedBalance =
        nativeBalance > 0 ? formatNumber(nativeBalance.toString(), 4) : '0';

      const fiatValue =
        nativeBalance > 0 ? getFiatAmount(nativeBalance, 4) : '$0.00';

      const assets = accountAssets[accType]?.[account.id];
      const allAssets = isBitcoinBased ? assets?.syscoin : assets?.ethereum;
      const tokens = Array.isArray(allAssets)
        ? allAssets.filter(
            (asset: any) => asset.contractAddress && asset.balance > 0
          )
        : [];

      return { balance: formattedBalance, fiatValue, tokens };
    },
    [accountAssets, isBitcoinBased, getFiatAmount]
  );

  const handleAccept = async () => {
    await controllerEmitter(
      ['wallet', 'setAccount'],
      [connectedAccount.id, accountType, true]
    );
    dispatchBackgroundEvent(`${eventName}.${host}`, null);
    window.close();
  };

  const handleReject = async () => {
    window.close();
  };

  // Get balance info for both accounts
  const connectedAccountBalance = getAccountBalance(
    connectedAccount,
    accountType
  );
  const activeAccountBalance = getAccountBalance(
    activeAccount,
    activeAccountRef.type
  );

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto">
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
          {/* Connected Account */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider">
              {t('connections.requiredAccount')}
            </h4>
            <div className="w-full p-4 rounded-lg border border-brand-orange bg-bkg-2">
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative">
                    <AccountIcon account={connectedAccount} size={40} />
                  </div>
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="font-medium text-sm text-brand-white mb-1 truncate">
                      {connectedAccount.label}
                    </p>
                    <div className="flex items-center gap-1">
                      <Tooltip
                        content={connectedAccount.address}
                        placement="top"
                      >
                        <p className="text-xs text-brand-graylight">
                          {ellipsis(connectedAccount.address, 8, 4)}
                        </p>
                      </Tooltip>
                      <div className="inline-flex flex-shrink-0 items-center">
                        <button
                          onClick={() => {
                            copy(connectedAccount.address);
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
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-medium text-brand-white whitespace-nowrap">
                      {parseFloat(connectedAccountBalance.balance || '0')
                        .toFixed(8)
                        .replace(/\.?0+$/, '')}{' '}
                      {activeNetwork.currency?.toUpperCase() || 'SYS'}
                    </p>
                    <p className="text-xs text-brand-graylight whitespace-nowrap">
                      {connectedAccountBalance.fiatValue}
                    </p>
                    {connectedAccountBalance.tokens &&
                      connectedAccountBalance.tokens.length > 0 && (
                        <div className="mt-0.5 flex justify-end">
                          <TokenIconStack
                            tokens={connectedAccountBalance.tokens}
                          />
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Active Account */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider">
              Current Active Account
            </h4>
            <div className="w-full p-4 rounded-lg border border-brand-royalblue bg-bkg-2">
              <div className="flex items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="relative">
                    <AccountIcon account={activeAccount} size={40} />
                  </div>
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="font-medium text-sm text-brand-white mb-1 truncate">
                      {activeAccount?.label}
                    </p>
                    <div className="flex items-center gap-1">
                      <Tooltip content={activeAccount?.address} placement="top">
                        <p className="text-xs text-brand-graylight">
                          {ellipsis(activeAccount?.address, 8, 4)}
                        </p>
                      </Tooltip>
                      <div className="inline-flex flex-shrink-0 items-center">
                        <button
                          onClick={() => {
                            copy(activeAccount?.address);
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
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-medium text-brand-white whitespace-nowrap">
                      {parseFloat(activeAccountBalance.balance || '0')
                        .toFixed(8)
                        .replace(/\.?0+$/, '')}{' '}
                      {activeNetwork.currency?.toUpperCase() || 'SYS'}
                    </p>
                    <p className="text-xs text-brand-graylight whitespace-nowrap">
                      {activeAccountBalance.fiatValue}
                    </p>
                    {activeAccountBalance.tokens &&
                      activeAccountBalance.tokens.length > 0 && (
                        <div className="mt-0.5 flex justify-end">
                          <TokenIconStack
                            tokens={activeAccountBalance.tokens}
                          />
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Add bottom padding to account for fixed buttons */}
        <div className="pb-20"></div>
      </div>

      {/* Fixed button container at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <div className="flex gap-3 justify-center">
          <SecondaryButton type="button" onClick={handleReject}>
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton type="button" onClick={handleAccept}>
            {t('connections.switchAccount')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};
