import { isHexString } from '@ethersproject/bytes';
import { toSvg } from 'jdenticon';
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { LoadingSvg } from 'components/Icon/Icon';
import {
  SecondaryButton,
  PrimaryButton,
  Icon,
  Tooltip,
  IconButton,
} from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectAccountAssets } from 'state/vault/selectors';
import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';

// Component to render account icon matching the app's pattern - moved outside to prevent recreation
const AccountIcon = React.memo(
  ({
    account,
    size = 40,
    isConnected = false,
    connectedText = '',
  }: {
    account: any;
    connectedText?: string;
    isConnected?: boolean;
    size?: number;
  }) => {
    const iconRef = useRef<HTMLDivElement>(null);

    // Extract identifier to avoid object reference issues
    const identifier = account?.xpub || account?.address || '';

    useEffect(() => {
      if (!iconRef.current || !identifier) return;

      iconRef.current.innerHTML = toSvg(identifier, size, {
        backColor: '#07152B',
        padding: 1,
      });
    }, [identifier, size]); // Depend on the extracted identifier string

    const iconElement = (
      <div className="relative">
        <div
          ref={iconRef}
          className="add-identicon rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80"
          style={{ width: size, height: size }}
        />
        {isConnected && (
          <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-bkg-2"></div>
        )}
      </div>
    );

    // Only wrap in tooltip if connected
    if (isConnected && connectedText) {
      return (
        <Tooltip content={connectedText} placement="top">
          {iconElement}
        </Tooltip>
      );
    }

    return iconElement;
  }
);
AccountIcon.displayName = 'AccountIcon';

// Component to render overlapping token icons like MetaMask
const TokenIconStack = React.memo(
  ({ tokens, maxVisible = 3 }: { maxVisible?: number; tokens: any[] }) => {
    // Create a function to generate a unique key for visual deduplication
    const getVisualKey = (token: any) => {
      // If token has a logo, use that as the key
      if (token.logo) return `logo:${token.logo}`;
      // If token has a symbol, use that (since fallback will show symbol initial)
      if (token.symbol) return `symbol:${token.symbol.charAt(0).toUpperCase()}`;
      // Fallback to contract address or asset guid
      return `address:${token.contractAddress || token.assetGuid}`;
    };

    // Memoize token deduplication and sorting
    const { visibleTokens, remainingCount } = useMemo(() => {
      // Handle empty tokens case
      if (!tokens || tokens.length === 0) {
        return { visibleTokens: [], remainingCount: 0 };
      }

      // Deduplicate tokens by their visual appearance
      const uniqueTokens = tokens.reduce((acc: any[], token: any) => {
        const visualKey = getVisualKey(token);
        const exists = acc.some((t) => getVisualKey(t) === visualKey);
        if (!exists) {
          acc.push(token);
        }
        return acc;
      }, []);

      // Prioritize tokens with actual logos
      const sortedTokens = uniqueTokens.sort((a, b) => {
        const aHasLogo = !!a.logo;
        const bHasLogo = !!b.logo;
        if (aHasLogo && !bHasLogo) return -1;
        if (!aHasLogo && bHasLogo) return 1;
        return 0;
      });

      const visible = sortedTokens.slice(0, maxVisible);
      const remaining = uniqueTokens.length - visible.length;

      return { visibleTokens: visible, remainingCount: remaining };
    }, [tokens, maxVisible]);

    // Early return after hooks
    if (!tokens || tokens.length === 0) return null;

    return (
      <div className="flex items-center">
        <div className="flex">
          {visibleTokens.map((token, index) => (
            <div
              key={
                token.id || token.contractAddress || token.assetGuid || index
              }
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

export const ChangeAccount = () => {
  const { controllerEmitter } = useController();
  const dapp = useSelector((state: RootState) => state.dapp.dapps);
  const { accounts, isBitcoinBased, activeAccount } = useSelector(
    (state: RootState) => state.vault
  );
  const accountAssets = useSelector(selectAccountAssets);
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();
  const queryData = useQueryData();
  const { host, eventName } = queryData;
  const { t } = useTranslation();

  // Helper to check if account is valid for current network type
  const isAccountValidForNetwork = (account: any) => {
    if (!account) return false;
    return isBitcoinBased
      ? !isHexString(account.address)
      : isHexString(account.address);
  };

  // Get current account from query data (passed from popup), fallback to dapp state, then active account
  // But validate that the account is appropriate for the current network type
  let currentAccountId = queryData.currentAccountId;
  let currentAccountType = queryData.currentAccountType;

  // If not in query data, try dapp state
  if (currentAccountId === undefined && dapp[host]) {
    const dappAccount =
      accounts?.[dapp[host].accountType]?.[dapp[host].accountId];
    if (dappAccount && isAccountValidForNetwork(dappAccount)) {
      currentAccountId = dapp[host].accountId;
      currentAccountType = dapp[host].accountType;
    }
  }

  // Final fallback to active account
  if (currentAccountId === undefined) {
    currentAccountId = activeAccount?.id;
    currentAccountType = activeAccount?.type;
  }

  // Initialize state with null to properly track if user has made a selection
  const [accountId, setAccountId] = useState<number | null>(
    currentAccountId !== undefined ? currentAccountId : null
  );
  const [accountType, setCurrentAccountType] =
    useState<KeyringAccountType | null>(
      currentAccountType !== undefined ? currentAccountType : null
    );
  const [isChanging, setIsChanging] = useState<boolean>(false);

  // Helper function to get tokens for an account
  const getAccountTokens = useCallback(
    (account: any, accType: string) => {
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

  // Memoize filtered accounts to prevent recomputation
  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];

    return Object.entries(accounts)
      .map(([keyringAccountType, accountList]) => {
        const isValidAccount = (currentAccount: any) =>
          isBitcoinBased
            ? !isHexString(currentAccount.address)
            : isHexString(currentAccount.address);

        const validAccounts = Object.values(accountList).filter(isValidAccount);

        return {
          type: keyringAccountType,
          accounts: validAccounts,
        };
      })
      .filter(
        ({ accounts: keyringAccountsList }) => keyringAccountsList.length > 0
      );
  }, [accounts, isBitcoinBased]);

  const handleSetAccountId = (id: number, type: KeyringAccountType) => {
    setAccountId(id);
    setCurrentAccountType(type);
  };

  const handleChangeAccount = async () => {
    // Safety check - ensure we have valid account selection
    if (accountId === null || accountType === null) {
      console.error('[ChangeAccount] No account selected');
      return;
    }

    if (
      accountId === currentAccountId &&
      accountType === currentAccountType &&
      eventName !== 'requestPermissions'
    ) {
      // Dispatch event right before closing
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
      return;
    }

    setIsChanging(true);

    try {
      let response: any = null;

      //this should be passed to constant instead of being hardcoded
      if (eventName === 'requestPermissions') {
        const permissions = await controllerEmitter(
          ['dapp', 'requestPermissions'],
          [host, accountId, accountType]
        );
        response = permissions || [];
      } else {
        await controllerEmitter(
          ['dapp', 'changeAccount'],
          [host, accountId, accountType]
        );
        // For changeAccount, response is null to indicate completion
        response = null;
      }

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [accountId, accountType, true]
      );

      // Dispatch event right before closing
      dispatchBackgroundEvent(`${eventName}.${host}`, response);
      window.close();
    } catch (error) {
      console.error('Failed to change account:', error);
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        {/* Header section */}
        <div className="text-center px-6 py-6 border-b border-brand-gray300">
          <h3 className="text-xs text-brand-graylight uppercase tracking-wider mb-2">
            {eventName === 'requestPermissions'
              ? t('connections.requestPermissions')
              : t('connections.changeAccount')}
          </h3>
          <div className="flex items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {host.charAt(0).toUpperCase()}
              </span>
            </div>
            <p className="text-lg font-medium text-brand-white">{host}</p>
          </div>
          <p className="text-xs text-brand-graylight mt-2">
            {eventName === 'requestPermissions'
              ? t('connections.requestingPermissions')
              : t('connections.selectAccountToConnect')}
          </p>
        </div>

        {/* Accounts list */}
        <div className="px-4 py-4">
          {accounts && Object.keys(accounts).length > 0 ? (
            <div className="space-y-4">
              {filteredAccounts.map(
                ({ type: keyringType, accounts: keyringAccounts }) => (
                  <div key={keyringType}>
                    <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider mb-3 px-2">
                      {keyringType === KeyringAccountType.HDAccount
                        ? 'HD Account'
                        : keyringType === KeyringAccountType.Imported
                        ? 'Imported'
                        : keyringType}
                    </h4>
                    <div className="space-y-2">
                      {keyringAccounts.map((acc) => {
                        const isSelected =
                          acc.id === accountId && accountType === keyringType;
                        const isCurrent =
                          acc.id === currentAccountId &&
                          currentAccountType === keyringType;
                        const tokens = getAccountTokens(acc, keyringType);

                        return (
                          <div
                            key={`${acc.id}-${keyringType}`}
                            className={`w-full p-4 rounded-lg border transition-all duration-200 text-left group cursor-pointer
                              ${
                                isSelected
                                  ? 'border-brand-royalblue bg-bkg-4 shadow-md'
                                  : 'border-brand-gray300 bg-bkg-2 hover:bg-bkg-3 hover:border-brand-gray200'
                              }`}
                            role="button"
                            tabIndex={0}
                            onClick={() =>
                              handleSetAccountId(
                                acc.id,
                                keyringType as KeyringAccountType
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSetAccountId(
                                  acc.id,
                                  keyringType as KeyringAccountType
                                );
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-2 w-full">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <AccountIcon
                                  account={acc}
                                  size={40}
                                  isConnected={isCurrent}
                                  connectedText={
                                    isCurrent
                                      ? t('connections.currentlyConnected')
                                      : ''
                                  }
                                />
                                <div className="flex-1 min-w-0 pr-2">
                                  <p className="font-medium text-sm text-brand-white mb-1 truncate">
                                    {acc.label}
                                  </p>
                                  <div className="flex items-center gap-1">
                                    <Tooltip
                                      content={acc.address}
                                      placement="top"
                                    >
                                      <p className="text-xs text-brand-graylight">
                                        {acc.address
                                          ? ellipsis(acc.address, 8, 4)
                                          : t('connections.noAddress')}
                                      </p>
                                    </Tooltip>
                                    <div
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex flex-shrink-0 items-center relative z-20"
                                    >
                                      <IconButton
                                        onClick={() => {
                                          copy(acc.address);
                                          alert.info(t('home.addressCopied'));
                                        }}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                                      >
                                        <Icon
                                          name="copy"
                                          className="text-xs hover:text-brand-royalblue"
                                          size={10}
                                          wrapperClassname="h-[1em] flex items-center"
                                        />
                                      </IconButton>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="text-right">
                                  <LazyAccountBalance
                                    account={acc}
                                    accountType={keyringType}
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
                                <div
                                  className={`w-6 h-6 rounded-full border-2 transition-all duration-200 flex-shrink-0 flex items-center justify-center
                                  ${
                                    isSelected
                                      ? 'bg-brand-royalblue border-brand-royalblue'
                                      : 'bg-transparent border-brand-gray300 group-hover:border-brand-royalblue'
                                  }`}
                                >
                                  {isSelected && (
                                    <div className="flex items-center justify-center w-full h-full relative">
                                      <Icon
                                        name="check"
                                        className="text-white absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                                        size={12}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <LoadingSvg className="w-8 h-8 text-brand-royalblue animate-spin mx-auto mb-2" />
                <p className="text-brand-graylight">
                  {t('connections.loadingAccounts')}
                </p>
              </div>
            </div>
          )}

          {/* Info message with proper spacing from buttons */}
          <div className="mt-6 mb-4 px-2">
            <p className="text-xs text-center text-brand-graylight">
              {t('connections.onlyConnect')}{' '}
              <a
                href="https://docs.syscoin.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-royalblue hover:underline"
              >
                {t('connections.learnMore')}
              </a>
            </p>
          </div>
        </div>

        {/* Add bottom padding to account for fixed buttons */}
        <div className="pb-20"></div>
      </div>

      {/* Fixed button container at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <div className="flex gap-3 justify-center">
          <SecondaryButton
            type="button"
            onClick={() => window.close()}
            disabled={isChanging}
          >
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="button"
            onClick={handleChangeAccount}
            loading={isChanging}
            disabled={isChanging || accountId === null || accountType === null}
          >
            {eventName === 'requestPermissions'
              ? t('buttons.confirm')
              : t('buttons.change')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
};
