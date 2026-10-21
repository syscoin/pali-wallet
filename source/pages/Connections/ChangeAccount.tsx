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
import { AccountIdenticon } from 'components/AccountIdenticon';
import { LoadingSvg } from 'components/Icon/Icon';
import { Button, Icon, IconButton, Tooltip } from 'components/index';
import { ListLoadMore } from 'components/Loading/ListLoadMore';
import { ToastActionFooter } from 'components/ToastActionFooter';
import { TokenIconStack } from 'components/TokenIcon';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useIncrementalList } from 'hooks/useIncrementalList';
import { RootState } from 'state/store';
import { selectAccountAssets } from 'state/vault/selectors';
import { IDAppAccountSelectionContext } from 'types/controllers';
import { KeyringAccountType } from 'types/network';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
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
    const iconElement = (
      <div className="relative">
        <AccountIdenticon account={account} size={size} />
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

export const ChangeAccount = () => {
  const { controllerEmitter } = useController();
  const dapp = useSelector((state: RootState) => state.dapp.dapps);
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const accountAssets = useSelector(selectAccountAssets);
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();
  const queryData = useQueryData();
  const { approvalId, host, eventName } = queryData;
  const { t } = useTranslation();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const liveContext = useRef({
    approvalId,
    accounts,
    activeNetwork,
    isBitcoinBased,
    host,
    eventName,
  });
  liveContext.current = {
    approvalId,
    accounts,
    activeNetwork,
    isBitcoinBased,
    host,
    eventName,
  };

  const isBridgeHost = React.useMemo(() => {
    const safeHost = (host || '').toLowerCase();
    return (
      safeHost.includes('bridge.syscoin.org') ||
      safeHost.includes('bridge-staging.syscoin.org')
    );
  }, [host]);

  // Helper to check if account is valid for current network type
  const isAccountValidForNetwork = useCallback(
    (account: any, keyringAccountType?: KeyringAccountType | string) =>
      isAccountCompatibleWithNetwork(
        account,
        keyringAccountType || '',
        activeNetwork
      ),
    [activeNetwork]
  );

  // Get current account from query data (passed from popup), fallback to dapp state, then active account
  // But validate that the account is appropriate for the current network type
  let currentAccountId = queryData.currentAccountId;
  let currentAccountType = queryData.currentAccountType;

  if (currentAccountId !== undefined && currentAccountType !== undefined) {
    const queryAccount = accounts?.[currentAccountType]?.[currentAccountId];
    if (!isAccountValidForNetwork(queryAccount, currentAccountType)) {
      currentAccountId = undefined;
      currentAccountType = undefined;
    }
  }

  // If not in query data, try dapp state
  if (currentAccountId === undefined && dapp[host]) {
    const dappAccount =
      accounts?.[dapp[host].accountType]?.[dapp[host].accountId];
    if (
      dappAccount &&
      isAccountValidForNetwork(dappAccount, dapp[host].accountType)
    ) {
      currentAccountId = dapp[host].accountId;
      currentAccountType = dapp[host].accountType;
    }
  }

  // Final fallback to active account
  if (currentAccountId === undefined) {
    const activeAccountData =
      accounts?.[activeAccount?.type]?.[activeAccount?.id];
    if (isAccountValidForNetwork(activeAccountData, activeAccount?.type)) {
      currentAccountId = activeAccount?.id;
      currentAccountType = activeAccount?.type;
    }
  }

  const captureSelection = (id: number, type: KeyringAccountType) => {
    const account = accounts?.[type]?.[id];
    if (!isAccountValidForNetwork(account, type)) return null;
    const context: IDAppAccountSelectionContext = {
      address: account.address,
      xpub: account.xpub,
      network: {
        kind: activeNetwork.kind,
        chainId: activeNetwork.chainId,
        url: activeNetwork.url,
        slip44: activeNetwork.slip44,
      },
    };
    return { id, type, context, approvalId, host, eventName, isBitcoinBased };
  };
  // Keep the reviewed identity, not only its reusable numeric account id.
  const [selection, setSelection] = useState(() =>
    captureSelection(currentAccountId, currentAccountType)
  );
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const accountId = selection?.id ?? null;
  const accountType = selection?.type ?? null;
  const isSelectionCurrent = (candidate: typeof selection) => {
    if (!mountedRef.current || !candidate || candidate !== selectionRef.current)
      return false;
    const current = liveContext.current;
    const account = current.accounts?.[candidate.type]?.[candidate.id];
    const expected = candidate.context;
    return (
      current.approvalId === candidate.approvalId &&
      current.host === candidate.host &&
      current.eventName === candidate.eventName &&
      current.isBitcoinBased === candidate.isBitcoinBased &&
      isAccountCompatibleWithNetwork(
        account,
        candidate.type,
        current.activeNetwork
      ) &&
      account.address === expected.address &&
      account.xpub === expected.xpub &&
      current.activeNetwork.kind === expected.network.kind &&
      current.activeNetwork.chainId === expected.network.chainId &&
      current.activeNetwork.url === expected.network.url &&
      current.activeNetwork.slip44 === expected.network.slip44
    );
  };
  const selectionIsCurrent = isSelectionCurrent(selection);
  const scope = JSON.stringify([
    approvalId,
    host,
    eventName,
    isBitcoinBased,
    activeNetwork.kind,
    activeNetwork.chainId,
    activeNetwork.url,
    activeNetwork.slip44,
  ]);
  const submissionState = useRef<{
    phase: 'ready' | 'submitting' | 'completed';
    scope: string;
  }>({ scope, phase: 'ready' });
  if (submissionState.current.scope !== scope)
    submissionState.current = { scope, phase: 'ready' };
  const submission = submissionState.current;
  const isCurrentSubmission = () => submissionState.current === submission;
  const [pendingSubmission, setPendingSubmission] =
    useState<typeof submission>();
  const isChanging = pendingSubmission === submission;
  const [selectionError, setSelectionError] = useState('');
  const [search, setSearch] = useState('');

  const showTrezorUtxoDisclaimer = React.useMemo(
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
    `${scope}:${search}`
  );
  const filteredAccounts = useMemo(() => {
    // Keep both the existing connection and proposed selection visible.
    const pinned = eligibleAccounts.filter(
      ({ account, type }) =>
        (account.id === accountId && type === accountType) ||
        (account.id === currentAccountId && type === currentAccountType)
    );
    const displayed = [
      ...visibleItems,
      ...pinned.filter((entry) => !visibleItems.includes(entry)),
    ];
    return Object.values(
      displayed.reduce((groups, entry) => {
        (groups[entry.type] ||= {
          type: entry.type,
          accounts: [],
        }).accounts.push(entry.account);
        return groups;
      }, {} as Record<string, { accounts: (typeof accounts)[KeyringAccountType.HDAccount][number][]; type: string }>)
    );
  }, [
    accountId,
    accountType,
    currentAccountId,
    currentAccountType,
    eligibleAccounts,
    visibleItems,
  ]);

  const handleSetAccountId = (id: number, type: KeyringAccountType) => {
    if (
      !mountedRef.current ||
      !isCurrentSubmission() ||
      submission.phase !== 'ready'
    )
      return;
    setSelection(captureSelection(id, type));
    setSelectionError('');
  };

  const handleClose = () => {
    if (
      !mountedRef.current ||
      !isCurrentSubmission() ||
      submission.phase !== 'ready'
    )
      return;
    submission.phase = 'completed';
    window.close();
  };

  const handleChangeAccount = async () => {
    // Safety check - ensure we have valid account selection
    if (
      !isCurrentSubmission() ||
      submission.phase !== 'ready' ||
      !selection ||
      !isSelectionCurrent(selection)
    )
      return;
    // Claim the attempt synchronously: React state alone cannot guard retained
    // callbacks or rapid clicks before the disabled state has rendered.
    submission.phase = 'submitting';
    setPendingSubmission(submission);

    if (
      accountId === currentAccountId &&
      accountType === currentAccountType &&
      eventName !== 'requestPermissions'
    ) {
      // Dispatch event right before closing
      submission.phase = 'completed';
      dispatchBackgroundEvent(`${eventName}.${host}`, null);
      window.close();
      return;
    }

    try {
      let response: any = null;

      //this should be passed to constant instead of being hardcoded
      if (eventName === 'requestPermissions') {
        const permissions = await controllerEmitter(
          ['dapp', 'requestPermissions'],
          [host, accountId, accountType, selection.context]
        );
        response = permissions || [];
      } else {
        await controllerEmitter(
          ['dapp', 'changeAccount'],
          [host, accountId, accountType, selection.context]
        );
        // For changeAccount, response is null to indicate completion
        response = null;
      }

      if (isCurrentSubmission() && isSelectionCurrent(selection)) {
        try {
          await controllerEmitter(
            ['wallet', 'setAccount'],
            [accountId, accountType, true, selection.context.address]
          );
        } catch (error) {
          // The origin's grant is already durable; optional wallet selection
          // must not turn that admitted operation into an unanswered failure.
          console.error('Permission saved but wallet selection failed:', error);
        }
      }

      // Settle the admitted operation for its original approval document. A
      // replacement view must not be closed by this operation's completion.
      submission.phase = 'completed';
      if (liveContext.current.approvalId === approvalId)
        dispatchBackgroundEvent(`${eventName}.${host}`, response);
      if (isCurrentSubmission() && isSelectionCurrent(selection))
        window.close();
    } catch (error) {
      console.error('Failed to change account:', error);
      if (isCurrentSubmission() && isSelectionCurrent(selection))
        setSelectionError(error?.message || t('send.failed'));
    } finally {
      if (submission.phase === 'submitting') {
        submission.phase = 'ready';
        if (mountedRef.current && isCurrentSubmission())
          setPendingSubmission(undefined);
      }
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
          <input
            type="search"
            aria-label={t('connections.searchAccounts')}
            placeholder={t('connections.searchAccounts')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full mb-4 rounded-lg border border-brand-gray300 bg-bkg-2 p-3 text-sm text-brand-white"
          />
          {matchingAccounts.length === 0 && (
            <p role="status" className="text-sm text-brand-graylight">
              {t('connections.noMatchingAccounts')}
            </p>
          )}
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
                          selectionIsCurrent &&
                          acc.id === accountId &&
                          accountType === keyringType;
                        const isCurrent =
                          acc.id === currentAccountId &&
                          currentAccountType === keyringType;
                        const tokens = getAccountTokens(acc, keyringType);

                        return (
                          <div
                            key={`${acc.id}-${keyringType}`}
                            className={`w-full p-4 rounded-lg border transition-all duration-200 text-left group ${
                              isChanging
                                ? 'cursor-wait opacity-70'
                                : 'cursor-pointer'
                            }
                              ${
                                isSelected
                                  ? 'border-brand-royalblue bg-bkg-4 shadow-md'
                                  : 'border-brand-gray300 bg-bkg-2 hover:bg-bkg-3 hover:border-brand-gray200'
                              }`}
                            role="button"
                            aria-disabled={isChanging}
                            tabIndex={isChanging ? -1 : 0}
                            onClick={() =>
                              handleSetAccountId(
                                acc.id,
                                keyringType as KeyringAccountType
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
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
                                        aria-label={t(
                                          'transactions.copyAddress'
                                        )}
                                        onClick={async () => {
                                          try {
                                            await copy(acc.address);
                                            alert.info(t('home.addressCopied'));
                                          } catch {
                                            alert.error(
                                              t('transactions.copyFailed')
                                            );
                                          }
                                        }}
                                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-200"
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
      <ToastActionFooter className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        {selectionError && (
          <p role="alert" className="text-xs text-brand-red mb-2">
            {selectionError}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <Button
            variant="secondary"
            type="button"
            onClick={handleClose}
            disabled={isChanging}
          >
            {t('buttons.cancel')}
          </Button>

          <Button
            variant="primary"
            type="button"
            onClick={handleChangeAccount}
            loading={isChanging}
            disabled={isChanging || !selectionIsCurrent}
          >
            {eventName === 'requestPermissions'
              ? t('buttons.confirm')
              : t('buttons.change')}
          </Button>
        </div>
      </ToastActionFooter>
    </div>
  );
};
