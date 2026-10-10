import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { Button, CenterTitle, DialogPrimitive, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { useIncrementalList } from 'hooks/useIncrementalList';
import { usePageLoadingState } from 'hooks/usePageLoadingState';
import store, { RootState } from 'state/store';
import {
  INetworkType,
  IKeyringAccountState,
  KeyringAccountType,
} from 'types/network';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
import { ellipsis } from 'utils/index';
import {
  createBrowsingNavigationContext,
  getWalletNavigationScope,
  captureNavigationScroll,
  navigateWithContext,
} from 'utils/navigationState';

const SmartAccountEntry = ({
  pickerOnly = false,
}: {
  pickerOnly?: boolean;
}) => {
  const location = useLocation();
  const networkScope = getWalletNavigationScope().network;
  const savedPicker = location.state?.smartAccountPicker;
  const restoredPicker =
    savedPicker?.network === networkScope ? savedPicker : undefined;
  const { t } = useTranslation();
  const { navigate, alert } = useUtils();
  const { controllerEmitter, handleWalletLockedError, connectionUnavailable } =
    useController();
  const { isContextChanging } = usePageLoadingState();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const [showPicker, setShowPicker] = useState(restoredPicker?.open === true);
  const [search, setSearch] = useState(restoredPicker?.search || '');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const switching = useRef(false);
  const mounted = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);
  const context = `${activeNetwork.kind}:${activeNetwork.chainId}:${activeNetwork.url}`;
  const disabled =
    isContextChanging || connectionUnavailable || pendingId !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setShowPicker(restoredPicker?.open === true);
    setSearch(restoredPicker?.search || '');
  }, [context, restoredPicker?.open, restoredPicker?.search]);

  const eligibleAccounts = useMemo(
    () =>
      Object.values(accounts[KeyringAccountType.SmartAccount] || {}).filter(
        (account) =>
          isAccountCompatibleWithNetwork(
            account,
            KeyringAccountType.SmartAccount,
            activeNetwork
          )
      ),
    [accounts, activeNetwork]
  );
  const matchingAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return eligibleAccounts.filter((account) =>
      `${account.label} ${account.address}`.toLowerCase().includes(query)
    );
  }, [eligibleAccounts, search]);
  const { visibleItems, visibleCount, hasMore, showMore } = useIncrementalList(
    matchingAccounts,
    `${context}:${search}`,
    restoredPicker?.visibleCount || 50
  );

  const pickerSnapshot = (open: boolean) => ({
    open,
    search,
    visibleCount,
    network: networkScope,
    scrollTop: listRef.current?.scrollTop || 0,
  });
  const updatePicker = (open: boolean, query = search) => {
    setShowPicker(open);
    setSearch(query);
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: {
        ...location.state,
        smartAccountPicker: {
          ...pickerSnapshot(open),
          search: query,
          visibleCount: query === search ? visibleCount : 50,
        },
      },
    });
  };
  useEffect(() => {
    if (
      !showPicker ||
      savedPicker?.network !== networkScope ||
      restoredPicker?.visibleCount === visibleCount
    )
      return;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: {
        ...location.state,
        smartAccountPicker: { ...restoredPicker, ...pickerSnapshot(true) },
      },
    });
  }, [visibleCount, showPicker]);
  useEffect(() => {
    if (showPicker && listRef.current)
      listRef.current.scrollTop = restoredPicker?.scrollTop || 0;
  }, [showPicker]);

  const contextIsCurrent = () => {
    const state = store.getState();
    const network = state.vault.activeNetwork;
    return (
      context === `${network.kind}:${network.chainId}:${network.url}` &&
      !['switching', 'connecting'].includes(state.vaultGlobal?.networkStatus) &&
      !state.vaultGlobal?.isSwitchingAccount
    );
  };

  const createSmartAccount = () => {
    if (
      disabled ||
      switching.current ||
      !contextIsCurrent() ||
      activeNetwork.kind !== INetworkType.Ethereum
    )
      return;
    navigateWithContext(
      navigate,
      '/settings/account/new',
      { smartAccountOnly: true },
      createBrowsingNavigationContext(location)
    );
  };

  const chooseAccount = async (account: IKeyringAccountState) => {
    if (disabled || switching.current || !contextIsCurrent()) return;
    const current =
      store.getState().vault.accounts[KeyringAccountType.SmartAccount]?.[
        account.id
      ];
    if (
      !current ||
      current.address !== account.address ||
      !isAccountCompatibleWithNetwork(
        current,
        KeyringAccountType.SmartAccount,
        store.getState().vault.activeNetwork
      )
    )
      return;
    const chooserContext = createBrowsingNavigationContext(location, {
      smartAccountPicker: pickerSnapshot(true),
    });
    chooserContext.scrollPositions = {
      ...captureNavigationScroll(),
      'smart-account-picker': listRef.current?.scrollTop || 0,
    };
    switching.current = true;
    setPendingId(account.id);
    try {
      await controllerEmitter(
        ['wallet', 'setAccount'],
        [account.id, KeyringAccountType.SmartAccount]
      );
      // The RPC reply and Redux publication may arrive in either order.
      const switched = await new Promise<boolean>((resolve) => {
        let unsubscribe: () => void = () => undefined;
        const finish = (result: boolean) => {
          unsubscribe();
          clearTimeout(timer);
          resolve(result);
        };
        const check = () => {
          if (getWalletNavigationScope().network !== networkScope) {
            finish(false);
            return;
          }
          const vault = store.getState().vault;
          if (
            vault.activeAccount.id === account.id &&
            vault.activeAccount.type === KeyringAccountType.SmartAccount &&
            vault.accounts[KeyringAccountType.SmartAccount]?.[account.id]
              ?.address === account.address
          )
            finish(true);
        };
        if (typeof store.subscribe === 'function')
          unsubscribe = store.subscribe(check);
        const timer = setTimeout(() => finish(false), 2000);
        check();
      });
      if (
        !switched ||
        (window.location.hash.startsWith('#/') &&
          window.location.hash.slice(1).split(/[?#]/)[0] !==
            '/home/smart-account')
      )
        return;
      // The account update can unmount this entry before its RPC resolves.
      // Commit the browsing step after success; Back opens the chooser without undoing the account switch.
      navigate('/home/smart-account', {
        state: {
          smartAccountPicker: { ...pickerSnapshot(false) },
          returnContext: chooserContext,
          walletScope: getWalletNavigationScope(),
        },
      });
      if (mounted.current) setShowPicker(false);
    } catch (error) {
      if (mounted.current && !handleWalletLockedError(error))
        alert.error(t('accountMenu.switchAccountError'));
    } finally {
      switching.current = false;
      if (mounted.current) setPendingId(null);
    }
  };

  return (
    <>
      {!pickerOnly && (
        <div className="flex flex-col items-center gap-4 p-6 text-brand-white">
          <Icon name="wallet" size={28} />
          <p className="text-sm text-center text-brand-gray200 max-w-xs">
            {activeNetwork.kind !== INetworkType.Ethereum
              ? t('smartAccountHub.evmNetworkRequired')
              : eligibleAccounts.length
              ? t('smartAccountHub.chooseAccountDescription')
              : t('smartAccountHub.noAccountsOnNetwork', {
                  network: activeNetwork.label,
                })}
          </p>
          {eligibleAccounts.length > 0 && (
            <Button
              variant="neutral"
              className="text-sm text-brand-royalblue max-w-xs"
              fullWidth
              type="button"
              disabled={disabled}
              onClick={() => updatePicker(true)}
            >
              {t('smartAccountHub.chooseAccount')}
            </Button>
          )}
          {activeNetwork.kind === INetworkType.Ethereum && (
            <Button
              variant={eligibleAccounts.length ? 'ghost' : 'neutral'}
              className={`text-sm max-w-xs ${
                eligibleAccounts.length ? '' : 'text-brand-royalblue'
              }`}
              fullWidth
              type="button"
              disabled={disabled}
              onClick={createSmartAccount}
            >
              {t('settings.createSmartAccount')}
            </Button>
          )}
        </div>
      )}
      <DialogPrimitive
        presentation="sheet"
        show={showPicker}
        onClose={() => {
          if (!switching.current) updatePicker(false);
        }}
      >
        <div className="w-screen max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl bg-bkg-4 p-5 text-brand-white">
          <CenterTitle>{t('smartAccountHub.chooseAccount')}</CenterTitle>
          <p className="mt-3 text-xs text-brand-gray200">
            {activeNetwork.label}
          </p>
          <input
            type="search"
            className="mt-4 mb-3 w-full rounded-lg border border-bkg-white200/30 bg-bkg-2 p-3 text-sm text-brand-white"
            placeholder={t('connections.searchAccounts')}
            aria-label={t('connections.searchAccounts')}
            value={search}
            disabled={disabled}
            onChange={(event) => updatePicker(true, event.target.value)}
          />
          <div
            ref={listRef}
            data-navigation-scroll="smart-account-picker"
            className="max-h-[35vh] overflow-y-auto remove-scrollbar space-y-2"
          >
            {visibleItems.map((account) => (
              <button
                key={account.id}
                data-testid={`smart-account-option-${account.id}`}
                type="button"
                disabled={disabled}
                aria-busy={pendingId === account.id}
                onClick={() => chooseAccount(account)}
                className="w-full rounded-lg bg-bkg-2 p-3 text-left hover:bg-bkg-3 disabled:opacity-60 disabled:cursor-wait"
              >
                <span className="block truncate text-sm text-brand-white">
                  {account.label}
                </span>
                <span
                  className="block mt-1 text-xs text-brand-gray200"
                  title={account.address}
                >
                  {pendingId === account.id
                    ? t('buttons.loading')
                    : ellipsis(account.address, 8, 8)}
                </span>
              </button>
            ))}
            {matchingAccounts.length === 0 && (
              <p role="status" className="py-3 text-sm text-brand-gray200">
                {t('connections.noMatchingAccounts')}
              </p>
            )}
            {hasMore && (
              <button
                type="button"
                disabled={disabled}
                onClick={showMore}
                className="py-2 text-sm text-brand-royalblue"
              >
                {t('buttons.loadMore')}
              </button>
            )}
          </div>
          <Button
            variant="ghost"
            type="button"
            className="mt-4"
            disabled={pendingId !== null}
            onClick={() => updatePicker(false)}
          >
            {t('buttons.cancel')}
          </Button>
        </div>
      </DialogPrimitive>
    </>
  );
};

export default SmartAccountEntry;
