import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

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
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

const SmartAccountEntry = () => {
  const { t } = useTranslation();
  const { navigate, alert } = useUtils();
  const { controllerEmitter, handleWalletLockedError, connectionUnavailable } =
    useController();
  const { isContextChanging } = usePageLoadingState();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const switching = useRef(false);
  const mounted = useRef(true);
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
    setShowPicker(false);
    setSearch('');
  }, [context]);

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
  const { visibleItems, hasMore, showMore } = useIncrementalList(
    matchingAccounts,
    `${context}:${search}`
  );

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
      createNavigationContext('/home/smart-account')
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
    switching.current = true;
    setPendingId(account.id);
    try {
      await controllerEmitter(
        ['wallet', 'setAccount'],
        [account.id, KeyringAccountType.SmartAccount]
      );
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
            onClick={() => setShowPicker(true)}
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
      <DialogPrimitive
        presentation="sheet"
        show={showPicker}
        onClose={() => {
          if (!switching.current) setShowPicker(false);
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
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-[35vh] overflow-y-auto remove-scrollbar space-y-2">
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
            onClick={() => setShowPicker(false)}
          >
            {t('buttons.cancel')}
          </Button>
        </div>
      </DialogPrimitive>
    </>
  );
};

export default SmartAccountEntry;
