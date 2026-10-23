/* eslint-disable react/prop-types */
import { Menu } from '@headlessui/react';
import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import ledgerLogo from 'assets/all_assets/ledgerLogo.png';
import trezorLogo from 'assets/all_assets/trezorLogo.png';
import { RiUserReceivedLine } from 'components/Icon/Icon';
import {
  PaliWhiteSmallIconSvg,
  LoadingSvg,
  LockIconSvg,
} from 'components/Icon/Icon';
import { Icon } from 'components/index';
import { useUtils } from 'hooks/useUtils';
import { RootState } from 'state/store';
import { selectActiveAccountRef } from 'state/vault';
import { KeyringAccountType } from 'types/network';
import { isAccountCompatibleWithNetwork } from 'utils/accountCompatibility';
import { ellipsis } from 'utils/index';

type RenderAccountsListByBitcoinBasedProps = {
  setActiveAccount: (
    id: number,
    type: KeyringAccountType
  ) => Promise<void | boolean>;
};

// Memoized badge info to prevent object recreation
const BADGE_INFO_MAP = {
  [KeyringAccountType.Trezor]: {
    label: 'Trezor',
    bgColor: 'bg-green-500',
    hoverColor: 'group-hover:bg-green-400',
    loadingColor: 'text-green-500',
  },
  [KeyringAccountType.Ledger]: {
    label: 'Ledger',
    bgColor: 'bg-blue-500',
    hoverColor: 'group-hover:bg-blue-400',
    loadingColor: 'text-blue-500',
  },
  [KeyringAccountType.Imported]: {
    label: 'Imported',
    bgColor: 'bg-orange-500',
    hoverColor: 'group-hover:bg-orange-400',
    loadingColor: 'text-orange-500',
  },
  [KeyringAccountType.SmartAccount]: {
    label: 'Smart Account',
    bgColor: 'bg-purple-500',
    hoverColor: 'group-hover:bg-purple-400',
    loadingColor: 'text-purple-500',
  },
  [KeyringAccountType.HDAccount]: {
    label: 'Pali',
    bgColor: 'bg-brand-royalblue',
    hoverColor: 'group-hover:bg-brand-blue500',
    loadingColor: 'text-brand-royalblue',
  },
} as const;

// Helper function to get account icon - moved outside to prevent recreation
const getAccountIcon = (accountType: KeyringAccountType, account: any) => {
  switch (accountType) {
    case KeyringAccountType.Trezor:
      return (
        <img
          src={trezorLogo}
          alt=""
          style={{
            filter:
              'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
          }}
          className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
        />
      );
    case KeyringAccountType.Ledger:
      return (
        <img
          src={ledgerLogo}
          alt=""
          style={{
            filter:
              'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
          }}
          className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
        />
      );
    case KeyringAccountType.Imported:
      // In EVM mode, check if it's imported to show import icon
      if (account.isImported) {
        return (
          <RiUserReceivedLine
            size={24}
            className="text-white opacity-90 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300"
          />
        );
      }
      // Fallback to Pali icon
      return (
        <PaliWhiteSmallIconSvg className="w-7 h-7 text-brand-gray300 opacity-80 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300" />
      );
    case KeyringAccountType.SmartAccount:
      return (
        <LockIconSvg className="w-6 h-6 text-white opacity-90 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300" />
      );
    case KeyringAccountType.HDAccount:
    default:
      return (
        <PaliWhiteSmallIconSvg className="w-7 h-7 text-brand-gray300 opacity-80 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300" />
      );
  }
};

// Optimized component with React.memo for re-render prevention
const RenderAccountsListByBitcoinBased =
  React.memo<RenderAccountsListByBitcoinBasedProps>(({ setActiveAccount }) => {
    const [switchingAccount, setSwitchingAccount] = useState<{
      id: number;
      type: KeyringAccountType;
    } | null>(null);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const switchInFlightRef = useRef(false);
    const mountedRef = useRef(true);
    const copySequenceRef = useRef(0);
    const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { t } = useTranslation();
    const { alert } = useUtils();

    const accounts = useSelector((state: RootState) => state.vault.accounts);
    const activeNetwork = useSelector(
      (state: RootState) => state.vault.activeNetwork
    );
    const activeAccount = useSelector(selectActiveAccountRef);
    const backgroundSwitching = useSelector(
      (state: RootState) => state.vaultGlobal.isSwitchingAccount
    );
    // When the accounts list is scrollable, a first click can be swallowed by inertial scrolling
    // (common on trackpads) or by focus/blur interactions. Handle selection on mouse pointer-down
    // so the first interaction reliably switches accounts.
    const lastMouseDownKeyRef = React.useRef<string | null>(null);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      };
    }, []);

    const handleAccountSwitch = useCallback(
      async (id: number, type: KeyringAccountType, close: () => void) => {
        // State alone cannot stop two events from the same render.
        if (backgroundSwitching || switchInFlightRef.current) return;
        switchInFlightRef.current = true;
        setSwitchingAccount({ id, type });
        try {
          const switched = await setActiveAccount(id, type);
          if (mountedRef.current && switched !== false) close();
        } catch {
          if (mountedRef.current)
            alert.error(t('accountMenu.switchAccountError'));
        } finally {
          switchInFlightRef.current = false;
          if (mountedRef.current) setSwitchingAccount(null);
        }
      },
      [setActiveAccount, backgroundSwitching, alert, t]
    );

    const isAccountSwitching = useCallback(
      (accountId: number, accountType: KeyringAccountType) =>
        switchingAccount?.id === accountId &&
        switchingAccount?.type === accountType,
      [switchingAccount]
    );

    const isAccountActive = useCallback(
      (accountId: number, accountType: KeyringAccountType) =>
        activeAccount.id === accountId && activeAccount.type === accountType,
      [activeAccount]
    );

    const handleCopyAddress = useCallback(
      async (key: string, address: string) => {
        const sequence = ++copySequenceRef.current;
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        setCopiedKey(null);
        try {
          await navigator.clipboard.writeText(address);
          if (sequence !== copySequenceRef.current) return;
          // Keyboard activation closes the menu before clipboard completion.
          // Keep the action's global outcome message, but never update a
          // dismissed row or leave it with a pending feedback timer.
          if (mountedRef.current) {
            setCopiedKey(key);
            copyTimeoutRef.current = setTimeout(() => {
              copyTimeoutRef.current = null;
              if (mountedRef.current) setCopiedKey(null);
            }, 1500);
          }
          alert.info(t('home.addressCopied'));
        } catch {
          if (sequence === copySequenceRef.current)
            alert.error(t('transactions.copyFailed'));
        }
      },
      [alert, t]
    );

    // Memoized account rendering to prevent recreation
    const renderAccount = useCallback(
      (
        account: any,
        accountType: KeyringAccountType,
        index: number,
        busy: boolean
      ) => {
        const badgeInfo = BADGE_INFO_MAP[accountType];
        const isSmartAccount = accountType === KeyringAccountType.SmartAccount;
        const badgeLabel = isSmartAccount
          ? t('receive.smartAccount')
          : accountType === KeyringAccountType.Imported
          ? t('components.imported')
          : badgeInfo.label;
        const key = `${accountType}-${account.id}`;
        return (
          <li
            id={`account-${accountType}-${index}`}
            role="none"
            className={`group relative px-5 w-full flex items-center gap-2 text-white text-sm font-medium ${
              isAccountSwitching(account.id, accountType)
                ? 'bg-brand-blue600/20 ring-1 ring-brand-blue500/30'
                : ''
            }`}
            key={key}
          >
            <Menu.Item disabled={busy}>
              {({ active, close }) => (
                <button
                  type="button"
                  aria-label={`${account.label} (${account.address})${
                    isSmartAccount ? `, ${badgeLabel}` : ''
                  }`}
                  aria-current={
                    isAccountActive(account.id, accountType)
                      ? 'true'
                      : undefined
                  }
                  disabled={busy}
                  className={`flex flex-1 items-center gap-2 min-w-0 min-h-[38px] text-left rounded-lg px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
                    active ? 'bg-brand-blue500/30' : 'hover:bg-brand-blue500/20'
                  } disabled:cursor-wait`}
                  onPointerDown={(e) => {
                    if (e.pointerType !== 'mouse' || e.button !== 0) return;
                    lastMouseDownKeyRef.current = key;
                    e.preventDefault();
                    void handleAccountSwitch(account.id, accountType, close);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    if (lastMouseDownKeyRef.current === key && e.detail > 0) {
                      lastMouseDownKeyRef.current = null;
                      return;
                    }
                    void handleAccountSwitch(account.id, accountType, close);
                  }}
                >
                  <span className="flex-shrink-0">
                    {getAccountIcon(accountType, account)}
                  </span>
                  <span className="truncate flex-1 min-w-0">
                    {account.label} ({ellipsis(account.address, 4, 4)})
                  </span>
                  {isAccountSwitching(account.id, accountType) ? (
                    <LoadingSvg
                      className={`w-4 animate-spin h-4 flex-shrink-0 ${badgeInfo.loadingColor}`}
                    />
                  ) : (
                    <span
                      title={isSmartAccount ? badgeLabel : undefined}
                      className={`inline-flex h-[20px] flex-shrink-0 items-center gap-1 ${
                        isSmartAccount ? 'px-1' : 'px-2'
                      } text-xs leading-none text-white ${
                        badgeInfo.bgColor
                      } rounded-full font-medium`}
                    >
                      {isAccountActive(account.id, accountType) && (
                        <Icon
                          name="check"
                          wrapperClassname="flex h-[12px] w-[12px] flex-shrink-0 items-center justify-center leading-none"
                          className="block h-[12px] w-[12px]"
                        />
                      )}
                      <span className="leading-none">
                        {isSmartAccount
                          ? t('smartAccountHub.badge')
                          : badgeLabel}
                      </span>
                    </span>
                  )}
                </button>
              )}
            </Menu.Item>
            <Menu.Item disabled={busy}>
              {({ active }) => (
                <button
                  type="button"
                  disabled={busy}
                  title={t('buttons.copy')}
                  aria-label={`${t('buttons.copy')}: ${account.label}`}
                  className={`flex items-center justify-center flex-shrink-0 min-w-[44px] min-h-[38px] rounded-lg text-brand-gray300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
                    active
                      ? 'bg-brand-blue500/30 text-white'
                      : 'hover:bg-brand-blue500/20'
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleCopyAddress(key, account.address);
                  }}
                >
                  {copiedKey === key ? (
                    <Icon
                      name="check"
                      className="w-3.5 h-3.5"
                      color="#8EC100"
                    />
                  ) : (
                    <Icon name="copy" className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </Menu.Item>
          </li>
        );
      },
      [
        isAccountSwitching,
        isAccountActive,
        handleAccountSwitch,
        handleCopyAddress,
        copiedKey,
        t,
      ]
    );

    // Memoize the account list computation
    const accountsList = useMemo(
      () =>
        Object.entries(accounts).flatMap(([accountType, accountsOfType]) =>
          Object.values(accountsOfType || {})
            .filter((account: any) =>
              isAccountCompatibleWithNetwork(
                account,
                accountType,
                activeNetwork
              )
            )
            .map((account, index) => ({
              account,
              accountType: accountType as KeyringAccountType,
              index,
            }))
        ),
      [accounts, activeNetwork.chainId, activeNetwork.kind]
    );

    const isAnySwitching = backgroundSwitching || switchingAccount !== null;

    return (
      <div
        className="relative w-full block"
        role="none"
        aria-busy={isAnySwitching}
      >
        {accountsList.map(({ account, accountType, index }) =>
          renderAccount(account, accountType, index, isAnySwitching)
        )}
      </div>
    );
  });

RenderAccountsListByBitcoinBased.displayName =
  'RenderAccountsListByBitcoinBased';

export default RenderAccountsListByBitcoinBased;
