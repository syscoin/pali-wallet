import { Dialog } from '@headlessui/react';
import { ShieldExclamationIcon } from '@heroicons/react/outline';
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
import { AccountIdenticon as AccountIcon } from 'components/AccountIdenticon';
import {
  CenterPanel,
  DialogActionButton,
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogPrimitive,
} from 'components/Dialog/Dialog';
import { LoadingSvg } from 'components/Icon/Icon';
import { Button, Icon, IconButton, Tooltip } from 'components/index';
import { ListLoadMore } from 'components/Loading/ListLoadMore';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { getAccountReviewTokens, TokenIconStack } from 'components/TokenIcon';
import trustedApps from 'constants/trustedApps.json';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useIncrementalList } from 'hooks/useIncrementalList';
import { resolveDappAccount } from 'state/dapp/accountScope';
import { RootState } from 'state/store';
import { selectAccountAssets } from 'state/vault/selectors';
import { KeyringAccountType } from 'types/network';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
import { dispatchBackgroundEvent } from 'utils/browser';
import { isTrustedDappOrigin } from 'utils/dappOrigin';
import { ellipsis } from 'utils/index';

import { useConnectionFocusClearance } from './useConnectionFocusClearance';

export const ConnectWallet = () => {
  const connectionFocusRef = useConnectionFocusClearance();
  const { controllerEmitter } = useController();
  const { host, chain, chainId, eventName } = useQueryData();
  const { t } = useTranslation();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeAccountData = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { kind, chainId: networkChainId, slip44 } = activeNetwork;
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
  const warningCancelRef = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState('');
  const accountsRef = useRef(accounts);
  const activeAccountRef = useRef(activeAccountData);
  accountsRef.current = accounts;
  activeAccountRef.current = activeAccountData;
  const date = Date.now();
  const selectionContext = JSON.stringify([
    host,
    chain,
    chainId,
    activeNetwork.kind,
    activeNetwork.chainId,
    activeNetwork.url,
  ]);

  const isBridgeHost = useMemo(
    () =>
      isTrustedDappOrigin(host || '', [
        'bridge.syscoin.org',
        'bridge-staging.syscoin.org',
      ]),
    [host]
  );

  const showTrezorUtxoDisclaimer = useMemo(
    () =>
      isBitcoinBased &&
      isBridgeHost &&
      accountType === KeyringAccountType.Trezor,
    [isBitcoinBased, isBridgeHost, accountType]
  );

  const isAccountValidForNetwork = useCallback(
    (account: any, keyringAccountType: KeyringAccountType | string) =>
      isAccountCompatibleWithNetwork(account, keyringAccountType, {
        kind,
        chainId: networkChainId,
        slip44,
      }),
    // Full background snapshots clone the network even for price-only updates.
    // Reinitialize consent only when its actual compatibility context changes.
    [kind, networkChainId, slip44]
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
    if (!isAccountValidForNetwork(selectedAccount, accountType)) {
      console.error('[ConnectWallet] Selected account is invalid for network');
      return;
    }
    // Keep the reviewed identity across account selection and its storage work.
    const expectedContext = {
      address: selectedAccount.address,
      xpub: selectedAccount.xpub,
      network: {
        kind: activeNetwork.kind,
        chainId: activeNetwork.chainId,
        url: activeNetwork.url,
        slip44: activeNetwork.slip44,
      },
    };

    setIsConnecting(true);
    try {
      await controllerEmitter(
        ['wallet', 'setAccount'],
        [accountId, accountType, true, expectedContext.address]
      );

      await controllerEmitter(
        ['dapp', 'connect'],
        [
          { host, chain, chainId, accountId, accountType, date },
          expectedContext,
        ]
      );

      // Return null - the method handler will return the actual address
      // This popup just establishes the connection
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      alert.error(error?.message || t('send.failed'));
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
    activeNetwork,
    eventName,
    isAccountValidForNetwork,
    alert,
    t,
  ]);

  const onConfirm = () => {
    // Check if the host is in the trusted apps list
    const isTrusted = isTrustedDappOrigin(host, trustedApps);

    if (isTrusted) {
      handleConnect();
    } else {
      setConfirmUntrusted(true);
    }
  };

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setAccountId(null);
    setAccountType(null);
    setCurrentAccountId(null);
    setCurrentAccountType(null);
    (async () => {
      try {
        const dapp: any = await controllerEmitter(['dapp', 'get'], [host]);
        if (!active) return;
        const latestAccounts = accountsRef.current;
        const { id: activeId, type: activeType } = activeAccountRef.current;
        const latestActiveAccount = latestAccounts?.[activeType]?.[activeId];

        if (dapp) {
          const dappAccount = resolveDappAccount(
            dapp,
            latestAccounts,
            activeNetwork
          );
          if (isAccountValidForNetwork(dappAccount, dapp.accountType)) {
            setCurrentAccountId(dapp.accountId);
            setCurrentAccountType(dapp.accountType);

            // Set the connected account as selected by default
            setAccountId(dapp.accountId);
            setAccountType(dapp.accountType);
          } else if (
            isAccountValidForNetwork(latestActiveAccount, activeType)
          ) {
            setAccountId(activeId);
            setAccountType(activeType);
          }
        } else if (isAccountValidForNetwork(latestActiveAccount, activeType)) {
          // If no existing connection, select the active account by default
          setAccountId(activeId);
          setAccountType(activeType);
        }
      } catch (error) {
        console.error('[ConnectWallet] Error fetching dapp data:', error);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [controllerEmitter, host, isAccountValidForNetwork, selectionContext]);

  // Remove the auto-close effect - let user make the choice

  // Get the currently connected account info
  const connectedAccount =
    currentAccountId !== undefined && currentAccountType !== undefined
      ? accounts[currentAccountType]?.[currentAccountId]
      : null;

  // Memoize filtered accounts to prevent recomputation
  const eligibleAccounts = useMemo(() => {
    if (!accounts) return [];
    return Object.entries(accounts).flatMap(([keyringType, accountList]) =>
      Object.values(accountList)
        .filter((account) => isAccountValidForNetwork(account, keyringType))
        .map((account) => ({ account, type: keyringType }))
    );
  }, [accounts, isAccountValidForNetwork]);
  const matchingAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return eligibleAccounts.filter(
      ({ account }) =>
        !query ||
        `${account.label} ${account.address}`.toLowerCase().includes(query)
    );
  }, [eligibleAccounts, search]);
  const { visibleItems, hasMore, showMore } = useIncrementalList(
    matchingAccounts,
    `${selectionContext}:${search}`
  );
  // Keep the selection visible even outside the search results or first page.
  const filteredAccounts = useMemo(() => {
    const selected = eligibleAccounts.find(
      ({ account, type: keyringType }) =>
        account.id === accountId && keyringType === accountType
    );
    const displayed =
      selected && !visibleItems.includes(selected)
        ? [...visibleItems, selected]
        : visibleItems;
    return Object.values(
      displayed.reduce((groups, entry) => {
        (groups[entry.type] ||= {
          type: entry.type,
          accounts: [],
        }).accounts.push(entry.account);
        return groups;
      }, {} as Record<string, { accounts: (typeof accounts)[KeyringAccountType.HDAccount][number][]; type: string }>)
    );
  }, [accountId, accountType, eligibleAccounts, visibleItems]);

  const selectedAccount = eligibleAccounts.find(
    ({ account, type }) => account.id === accountId && type === accountType
  )?.account;

  return (
    <div ref={connectionFocusRef} className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto remove-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSvg className="w-8 h-8 text-brand-royalblue animate-spin" />
          </div>
        ) : accounts && Object.keys(accounts).length > 0 ? (
          <>
            {/* Header section */}
            <div className="text-center px-6 py-6 border-b border-brand-gray300 [@media(max-height:400px)]:py-2">
              <h3 className="text-xs text-brand-graylight uppercase tracking-wider mb-2">
                {t('connections.connectRequest')}
              </h3>
              <div className="flex min-w-0 items-center justify-center gap-2">
                <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
                  <Icon name="link" className="text-white" size={16} />
                </div>
                <p className="min-w-0 text-lg font-medium text-brand-white [overflow-wrap:anywhere]">
                  {host}
                </p>
              </div>

              {connectedAccount && (
                <div className="mt-3 p-2 bg-bkg-4 rounded-lg">
                  <p className="text-xs text-brand-graylight">
                    {t('connections.currentlyConnected')}:{' '}
                    <span className="text-brand-white font-medium">
                      {connectedAccount.label}
                    </span>
                  </p>
                  <p className="text-[10px] text-brand-graylight mt-1">
                    {t('connections.selectDifferentAccountHint')}
                  </p>
                </div>
              )}

              {showTrezorUtxoDisclaimer && (
                <div className="mt-3 p-3 bg-red-900/20 border border-red-500 rounded-lg">
                  <p className="text-red-400 text-xs">
                    {t('connections.trezorUtxoBridgeUnsupported')}
                  </p>
                </div>
              )}
            </div>

            {/* Accounts list */}
            <div className="px-4 py-4 [@media(max-height:400px)]:py-2">
              <input
                type="search"
                aria-label={t('connections.searchAccounts')}
                placeholder={t('connections.searchAccounts')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full mb-4 rounded-lg border border-brand-gray300 bg-bkg-2 p-3 text-sm text-brand-white [@media(max-height:400px)]:mb-8"
              />
              {matchingAccounts.length === 0 && (
                <p role="status" className="text-sm text-brand-graylight">
                  {t('connections.noMatchingAccounts')}
                </p>
              )}
              <div className="space-y-4">
                {filteredAccounts.map(
                  ({ type: keyringType, accounts: keyringAccounts }) => (
                    <div key={keyringType}>
                      <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider mb-3 px-2">
                        {keyringType === KeyringAccountType.HDAccount
                          ? t('receive.hdAccount')
                          : keyringType === KeyringAccountType.Imported
                          ? t('components.imported')
                          : keyringType}
                      </h4>
                      <div className="space-y-2">
                        {keyringAccounts.map((acc) => {
                          const isSelected =
                            acc.id === accountId && accountType === keyringType;
                          const tokens = getAccountReviewTokens(
                            accountAssets,
                            isBitcoinBased,
                            acc,
                            keyringType
                          );

                          return (
                            <div
                              key={`${acc.id}-${keyringType}`}
                              className={`w-full p-4 rounded-lg border transition-all duration-200 text-left group cursor-pointer select-none
                                ${
                                  isSelected
                                    ? 'border-brand-royalblue bg-bkg-4 shadow-md'
                                    : 'border-brand-gray300 bg-bkg-2 hover:bg-bkg-3 hover:border-brand-gray200'
                                }`}
                              role="button"
                              aria-pressed={isSelected}
                              aria-disabled={isConnecting}
                              tabIndex={isConnecting ? -1 : 0}
                              onClick={() => {
                                if (isConnecting) return;
                                setAccountId(acc.id);
                                setAccountType(
                                  keyringType as KeyringAccountType
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (isConnecting) return;
                                  setAccountId(acc.id);
                                  setAccountType(
                                    keyringType as KeyringAccountType
                                  );
                                }
                              }}
                            >
                              <div className="flex flex-col gap-3 w-full [@media(min-width:400px)]:flex-row [@media(min-width:400px)]:items-center [@media(min-width:400px)]:justify-between [@media(min-width:400px)]:gap-2">
                                <div className="flex items-center gap-3 w-full min-w-0 [@media(min-width:400px)]:w-auto [@media(min-width:400px)]:flex-1">
                                  <div className="relative flex-shrink-0">
                                    <AccountIcon account={acc} size={40} />
                                  </div>
                                  <div className="flex-1 min-w-0 pr-2">
                                    <p className="font-medium text-sm text-brand-white mb-1 truncate">
                                      {acc.label}
                                    </p>
                                    <div className="flex items-center gap-1 min-w-0">
                                      <Tooltip
                                        content={acc.address}
                                        placement="top"
                                        childrenClassName="min-w-0"
                                      >
                                        <p className="text-xs text-brand-graylight truncate">
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
                                          disabled={isConnecting}
                                          aria-label={t(
                                            'transactions.copyAddress'
                                          )}
                                          onClick={async () => {
                                            try {
                                              await copy(acc.address);
                                              alert.info(
                                                t('home.addressCopied')
                                              );
                                            } catch {
                                              alert.error(
                                                t('transactions.copyFailed')
                                              );
                                            }
                                          }}
                                          className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-200"
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
                                <div className="flex items-center justify-between gap-3 w-full flex-shrink-0 [@media(min-width:400px)]:w-auto">
                                  <div className="text-left [@media(min-width:400px)]:text-right">
                                    <LazyAccountBalance
                                      account={acc}
                                      accountType={keyringType}
                                      showFiat={true}
                                      showSkeleton={true}
                                      precision={8}
                                    />
                                    {tokens && tokens.length > 0 && (
                                      <div className="mt-0.5 flex justify-start [@media(min-width:400px)]:justify-end">
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
              {hasMore && (
                <ListLoadMore
                  onClick={showMore}
                  shown={visibleItems.length}
                  total={matchingAccounts.length}
                />
              )}

              {/* Info message with proper spacing from buttons */}
              <div className="mt-6 mb-4 px-2">
                <p className="text-xs text-center text-brand-graylight">
                  {t('connections.onlyConnect')}{' '}
                  <a
                    href="https://docs.syscoin.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-royalbluemedium hover:underline"
                  >
                    {t('connections.learnMore')}
                  </a>
                </p>
              </div>
            </div>

            {/* Add bottom padding to account for fixed buttons */}
            <div
              className="pb-20"
              style={{
                paddingBottom:
                  'max(5rem, calc(var(--pali-toast-footer-clearance, 0px) + 1rem))',
              }}
            ></div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-brand-graylight">
              {t('connections.noAccountsAvailable')}
            </p>
          </div>
        )}
      </div>

      {/* Fixed button container at bottom of viewport */}
      <ToastActionFooter
        data-connection-actions
        className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50"
      >
        {selectedAccount && (
          <div
            aria-live="polite"
            data-connection-selected-summary
            className="hidden min-w-0 flex-col gap-1 pb-2 text-xs [@media(max-height:400px)]:flex"
          >
            <span className="text-brand-graylight">
              {t('connections.connectAccount')}:
            </span>
            <span className="flex min-w-0 items-center gap-1 text-brand-white">
              <span className="min-w-0 truncate">{selectedAccount.label}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">
                {selectedAccount.address
                  ? ellipsis(selectedAccount.address, 8, 4)
                  : t('connections.noAddress')}
              </span>
            </span>
          </div>
        )}
        {!selectedAccount && !isLoading && (
          <div
            aria-live="polite"
            data-connection-selection-required
            className="hidden pb-2 text-xs text-brand-graylight [@media(max-height:400px)]:block"
          >
            {t(
              eligibleAccounts.length
                ? 'connections.selectAccountToConnect'
                : 'connections.noAccountsAvailable'
            )}
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            type="button"
            onClick={() => window.close()}
            disabled={isConnecting}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            variant="primary"
            type="button"
            disabled={isConnecting || !selectedAccount}
            loading={isConnecting}
            onClick={onConfirm}
          >
            {t('buttons.confirm')}
          </Button>
        </div>
      </ToastActionFooter>

      <DialogPrimitive
        show={confirmUntrusted}
        initialFocus={warningCancelRef}
        onClose={() => !isConnecting && setConfirmUntrusted(false)}
      >
        <CenterPanel
          padded={false}
          scroll={false}
          className="flex flex-col"
          aria-busy={isConnecting}
        >
          <DialogHeader
            title={t('connections.nonTrusted')}
            icon={<ShieldExclamationIcon />}
            disabled={isConnecting}
            onClose={() => !isConnecting && setConfirmUntrusted(false)}
          />

          <DialogBody>
            <Dialog.Description className="text-content-secondary text-sm">
              {t('connections.nonTrustedMessage')}
            </Dialog.Description>
          </DialogBody>

          <DialogFooter>
            <DialogActions>
              <DialogActionButton
                ref={warningCancelRef}
                tone="secondary"
                type="button"
                onClick={() => setConfirmUntrusted(false)}
                disabled={isConnecting}
              >
                {t('buttons.cancel')}
              </DialogActionButton>

              <DialogActionButton
                tone="primary"
                type="button"
                onClick={handleConnect}
                loading={isConnecting}
                disabled={isConnecting}
              >
                {t('buttons.confirm')}
              </DialogActionButton>
            </DialogActions>
          </DialogFooter>
        </CenterPanel>
      </DialogPrimitive>
    </div>
  );
};
