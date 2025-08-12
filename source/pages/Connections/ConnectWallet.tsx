import { isHexString } from '@ethersproject/bytes';
import { Dialog } from '@headlessui/react';
import { toSvg } from 'jdenticon';
import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { LazyAccountBalance } from 'components/AccountBalance';
import { LoadingSvg } from 'components/Icon/Icon';
import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  Modal,
  Tooltip,
  IconButton,
} from 'components/index';
import { TokenIcon } from 'components/TokenIcon';
import trustedApps from 'constants/trustedApps.json';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectAccountAssets } from 'state/vault/selectors';
import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';

// Component to render account icon matching the app's pattern - moved outside to prevent recreation
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
    }, [identifier, size]); // Depend on the extracted identifier string

    return (
      <div
        ref={iconRef}
        className="add-identicon rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80"
        style={{ width: size, height: size }}
      />
    );
  }
);
AccountIcon.displayName = 'AccountIcon';

// Component to render overlapping token icons like MetaMask
const TokenIconStack = React.memo(
  ({ tokens, maxVisible = 3 }: { maxVisible?: number; tokens: any[] }) => {
    if (!tokens || tokens.length === 0) return null;

    // Create a function to generate a unique key for visual deduplication
    const getVisualKey = (token: any) => {
      // If token has a logo, use that as the key
      if (token.logo) return `logo:${token.logo}`;
      // If token has a symbol, use that (since fallback will show symbol initial)
      if (token.symbol) return `symbol:${token.symbol.charAt(0).toUpperCase()}`;
      // Fallback to contract address or asset guid
      return `address:${token.contractAddress || token.assetGuid}`;
    };

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

    const visibleTokens = sortedTokens.slice(0, maxVisible);
    const uniqueCount = uniqueTokens.length;
    const remainingCount = uniqueCount - visibleTokens.length;

    return (
      <div className="flex items-center">
        <div className="flex">
          {visibleTokens.map((token, index) => (
            <Tooltip
              key={
                token.id || token.contractAddress || token.assetGuid || index
              }
              content={token.name || token.symbol}
            >
              <div
                className="relative hover:scale-110 hover:shadow-md transition-transform duration-200"
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
            </Tooltip>
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

export const ConnectWallet = () => {
  const { controllerEmitter } = useController();
  const { host, chain, chainId, eventName } = useQueryData();
  const { t } = useTranslation();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { activeAccount: activeAccountData } = useSelector(
    (state: RootState) => state.vault
  );
  const { id, type } = activeAccountData;
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const accountAssets = useSelector(selectAccountAssets);
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();

  const [currentAccountId, setCurrentAccountId] = useState<number | null>(null);
  const [currentAccountType, setCurrentAccountType] =
    useState<KeyringAccountType | null>(null);

  const [accountId, setAccountId] = useState<number | null>(null);
  const [accountType, setAccountType] = useState<KeyringAccountType | null>(
    null
  );
  const [confirmUntrusted, setConfirmUntrusted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const date = Date.now();

  const isBridgeHost = useMemo(() => {
    const safeHost = (host || '').toLowerCase();
    return (
      safeHost.includes('bridge.syscoin.org') ||
      safeHost.includes('bridge-staging.syscoin.org')
    );
  }, [host]);

  const showTrezorUtxoDisclaimer = useMemo(
    () =>
      isBitcoinBased &&
      isBridgeHost &&
      accountType === KeyringAccountType.Trezor,
    [isBitcoinBased, isBridgeHost, accountType]
  );

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

  const handleConnect = useCallback(async () => {
    // Safety check - ensure we have valid account selection
    if (accountId === null || accountType === null) {
      console.error('[ConnectWallet] No account selected');
      return;
    }

    // Find the selected account
    const selectedAccount = accounts[accountType]?.[accountId];
    if (!selectedAccount) {
      console.error('[ConnectWallet] Selected account not found');
      return;
    }

    setIsConnecting(true);
    try {
      await controllerEmitter(
        ['dapp', 'connect'],
        [{ host, chain, chainId, accountId, accountType, date }]
      );

      await controllerEmitter(
        ['wallet', 'setAccount'],
        [accountId, accountType, true]
      );

      // Return null - the method handler will return the actual address
      // This popup just establishes the connection
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      setIsConnecting(false);
    }
  }, [
    host,
    chain,
    chainId,
    accountId,
    accountType,
    date,
    accounts,
    controllerEmitter,
    eventName,
  ]);

  const onConfirm = () => {
    // Check if the host is in the trusted apps list
    const isTrusted = trustedApps.some((trustedHost) =>
      host.toLowerCase().includes(trustedHost.toLowerCase())
    );

    if (isTrusted) {
      handleConnect();
    } else {
      setConfirmUntrusted(true);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const dapp: any = await controllerEmitter(['dapp', 'get'], [host]);

        if (dapp) {
          setCurrentAccountId(dapp?.accountId);
          setCurrentAccountType(dapp?.accountType);

          // Set the connected account as selected by default
          setAccountId(dapp?.accountId);
          setAccountType(dapp?.accountType);
        } else {
          // If no existing connection, select the active account by default
          setAccountId(id);
          setAccountType(type);
        }
      } catch (error) {
        console.error('[ConnectWallet] Error fetching dapp data:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [host, id, type]);

  // Remove the auto-close effect - let user make the choice

  // Get the currently connected account info
  const connectedAccount =
    currentAccountId !== undefined && currentAccountType !== undefined
      ? accounts[currentAccountType]?.[currentAccountId]
      : null;

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

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSvg className="w-8 h-8 text-brand-royalblue animate-spin" />
          </div>
        ) : accounts && Object.keys(accounts).length > 0 ? (
          <>
            {/* Header section */}
            <div className="text-center px-6 py-6 border-b border-brand-gray300">
              <h3 className="text-xs text-brand-graylight uppercase tracking-wider mb-2">
                Connect Request
              </h3>
              <div className="flex items-center justify-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
                  <Icon name="link" className="text-white" size={16} />
                </div>
                <p className="text-lg font-medium text-brand-white">{host}</p>
              </div>

              {connectedAccount && (
                <div className="mt-3 p-2 bg-bkg-4 rounded-lg">
                  <p className="text-xs text-brand-graylight">
                    Currently connected to:{' '}
                    <span className="text-brand-white font-medium">
                      {connectedAccount.label}
                    </span>
                  </p>
                  <p className="text-[10px] text-brand-graylight mt-1">
                    Selecting a different account will switch the connection
                  </p>
                </div>
              )}

              {showTrezorUtxoDisclaimer && (
                <div className="mt-3 p-3 bg-red-900/20 border border-red-500 rounded-lg">
                  <p className="text-red-400 text-xs">
                    Trezor is not supported for UTXO accounts on Syscoin Bridge.
                  </p>
                </div>
              )}
            </div>

            {/* Accounts list */}
            <div className="px-4 py-4">
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
                          const tokens = getAccountTokens(acc, keyringType);

                          return (
                            <div
                              key={`${acc.id}-${type}`}
                              className={`w-full p-4 rounded-lg border transition-all duration-200 text-left group cursor-pointer
                                ${
                                  isSelected
                                    ? 'border-brand-royalblue bg-bkg-4 shadow-md'
                                    : 'border-brand-gray300 bg-bkg-2 hover:bg-bkg-3 hover:border-brand-gray200'
                                }`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setAccountId(acc.id);
                                setAccountType(
                                  keyringType as KeyringAccountType
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setAccountId(acc.id);
                                  setAccountType(
                                    keyringType as KeyringAccountType
                                  );
                                }
                              }}
                            >
                              <div className="flex items-center justify-between gap-2 w-full">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className="relative">
                                    <AccountIcon account={acc} size={40} />
                                  </div>
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
                                            : 'No address'}
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
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-brand-graylight">No accounts available</p>
          </div>
        )}
      </div>

      {/* Fixed button container at bottom of viewport */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <div className="flex gap-3 justify-center">
          <SecondaryButton
            type="button"
            onClick={() => window.close()}
            disabled={isConnecting}
          >
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="button"
            disabled={
              isConnecting || accountId === null || accountType === null
            }
            loading={isConnecting}
            onClick={onConfirm}
          >
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>

      <Modal show={confirmUntrusted} onClose={() => setConfirmUntrusted(false)}>
        <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-4 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
          <Dialog.Title
            as="h3"
            className="flex gap-3 items-center justify-center text-brand-white text-lg font-medium leading-6"
          >
            <Icon name="warning" className="mb-2 text-brand-white" />
            <p>{t('connections.nonTrusted')}</p>
          </Dialog.Title>

          <div className="mt-4">
            <p className="text-brand-white text-sm">
              {t('connections.nonTrustedMessage')}
            </p>
          </div>

          <div className="flex gap-5 items-center justify-between mt-8">
            <SecondaryButton
              width="36"
              type="button"
              onClick={() => setConfirmUntrusted(false)}
              disabled={isConnecting}
            >
              {t('buttons.cancel')}
            </SecondaryButton>

            <PrimaryButton
              width="36"
              type="button"
              onClick={handleConnect}
              loading={isConnecting}
              disabled={isConnecting}
            >
              {t('buttons.confirm')}
            </PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
};
