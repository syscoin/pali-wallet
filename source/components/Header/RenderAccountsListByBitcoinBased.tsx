/* eslint-disable react/prop-types */
import { Menu } from '@headlessui/react';
import React, { useState, useCallback, useMemo } from 'react';
import { RiUserReceivedLine } from 'react-icons/ri';
import { useSelector } from 'react-redux';

import ledgerLogo from 'assets/all_assets/ledgerLogo.png';
import trezorLogo from 'assets/all_assets/trezorLogo.png';
import { PaliWhiteSmallIconSvg, LoadingSvg } from 'components/Icon/Icon';
import { Icon } from 'components/index';
import { RootState } from 'state/store';
import { selectActiveAccountRef } from 'state/vault';
import { KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/index';

type RenderAccountsListByBitcoinBasedProps = {
  setActiveAccount: (id: number, type: KeyringAccountType) => Promise<void>;
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

    const accounts = useSelector((state: RootState) => state.vault.accounts);
    const activeAccount = useSelector(selectActiveAccountRef);
    // When the accounts list is scrollable, a first click can be swallowed by inertial scrolling
    // (common on trackpads) or by focus/blur interactions. Handle selection on mouse pointer-down
    // so the first interaction reliably switches accounts.
    const lastMouseDownKeyRef = React.useRef<string | null>(null);

    const handleAccountSwitch = useCallback(
      async (id: number, type: KeyringAccountType, close: () => void) => {
        setSwitchingAccount({ id, type });
        try {
          await setActiveAccount(id, type);
          close();
        } finally {
          setSwitchingAccount(null);
        }
      },
      [setActiveAccount]
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

    // Memoized account rendering to prevent recreation
    const renderAccount = useCallback(
      (
        account: any,
        accountType: KeyringAccountType,
        index: number,
        close: () => void
      ) => {
        const badgeInfo = BADGE_INFO_MAP[accountType];
        const key = `${accountType}-${account.id}`;
        const triggerSwitch = () => {
          if (isAccountSwitching(account.id, accountType)) return;
          handleAccountSwitch(account.id, accountType, close);
        };

        return (
          <li
            className={`group relative py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
          font-medium cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none transform
           transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 ${
             isAccountSwitching(account.id, accountType)
               ? 'bg-brand-blue600/20 ring-1 ring-brand-blue500/30'
               : ''
           }`}
            onPointerDown={(e) => {
              // Only do this for mouse clicks to avoid breaking touch scrolling.
              if ((e as any).pointerType !== 'mouse') return;
              // Only left button.
              if ((e as any).button !== 0) return;
              lastMouseDownKeyRef.current = key;
              // Prevent focus changes that can cause the Menu to shift/scroll before click fires.
              e.preventDefault();
              triggerSwitch();
            }}
            onClick={() => {
              // If we already handled this interaction on pointer-down, ignore the click.
              if (lastMouseDownKeyRef.current === key) {
                lastMouseDownKeyRef.current = null;
                return;
              }
              triggerSwitch();
            }}
            id={`account-${accountType}-${index}`}
            key={key}
          >
            {/* Background glow effect on hover */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

            {/* Left side: Icon + Account name */}
            <div className="flex items-center gap-2 flex-1 min-w-0 relative z-10">
              <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                {getAccountIcon(accountType, account)}
              </div>
              <span className="group-hover:text-white transition-colors duration-300 truncate">
                {account.label} ({ellipsis(account.address, 4, 4)})
              </span>
            </div>

            {/* Right side: Badge + Checkmark */}
            <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
              {isAccountSwitching(account.id, accountType) ? (
                <LoadingSvg
                  className={`w-4 animate-spin h-4 ${badgeInfo.loadingColor}`}
                />
              ) : (
                <>
                  <span
                    className={`text-xs px-2 py-0.5 text-white ${badgeInfo.bgColor} rounded-full font-medium shadow-sm group-hover:shadow-md ${badgeInfo.hoverColor} transform group-hover:scale-105 transition-all duration-300`}
                  >
                    {badgeInfo.label}
                  </span>
                  {isAccountActive(account.id, accountType) && (
                    <div className="transform group-hover:scale-110 transition-transform duration-300">
                      <Icon name="check" className="w-4 h-4" color="#8EC100" />
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        );
      },
      [isAccountSwitching, isAccountActive, handleAccountSwitch]
    );

    // Memoize the account list computation
    const accountsList = useMemo(
      () =>
        Object.entries(accounts).flatMap(([accountType, accountsOfType]) =>
          Object.values(accountsOfType || {}).map((account, index) => ({
            account,
            accountType: accountType as KeyringAccountType,
            index,
          }))
        ),
      [accounts]
    );

    const isAnySwitching = switchingAccount !== null;

    return (
      <Menu.Item>
        {({ close }) => (
          <div
            className={`relative w-full block ${
              isAnySwitching ? 'pointer-events-none' : ''
            }`}
          >
            {/* Gray overlay when any account is switching */}
            {isAnySwitching && (
              <div className="absolute inset-0 bg-gray-500/30 z-20 rounded-lg backdrop-blur-[0.5px]" />
            )}

            {accountsList.map(({ account, accountType, index }) =>
              renderAccount(account, accountType, index, close)
            )}
          </div>
        )}
      </Menu.Item>
    );
  });

RenderAccountsListByBitcoinBased.displayName =
  'RenderAccountsListByBitcoinBased';

export default RenderAccountsListByBitcoinBased;
