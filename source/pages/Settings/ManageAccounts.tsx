import React, {
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import { RiUserReceivedLine } from 'react-icons/ri/';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import ledgerLogo from 'assets/all_assets/ledgerLogo.png';
import trezorLogo from 'assets/all_assets/trezorLogo.png';
import { PaliWhiteSmallIconSvg } from 'components/Icon/Icon';
import {
  IconButton,
  Icon,
  NeutralButton,
  ConfirmationModal,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { IKeyringAccountState, KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/index';
import { navigateWithContext } from 'utils/navigationState';

// Static account type configuration to prevent recreation
const ACCOUNT_TYPE_CONFIG = {
  [KeyringAccountType.HDAccount]: {
    label: 'Pali',
    bgColor: 'bg-brand-royalblue',
    icon: (props: any) => (
      <PaliWhiteSmallIconSvg
        className="mr-1 w-7 text-brand-gray300 opacity-80 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300"
        {...props}
      />
    ),
  },
  [KeyringAccountType.Imported]: {
    label: 'Imported',
    bgColor: 'bg-orange-500',
    icon: (props: any) => (
      <RiUserReceivedLine
        size={24}
        className="mr-1 text-white opacity-90 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300"
        {...props}
      />
    ),
  },
  [KeyringAccountType.Trezor]: {
    label: 'Trezor',
    bgColor: 'bg-green-500',
    icon: (props: any) => (
      <img
        src={trezorLogo}
        alt=""
        className="mr-1 w-5 h-5 group-hover:brightness-110 transition-all duration-300"
        style={{
          filter:
            'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
        }}
        {...props}
      />
    ),
  },
  [KeyringAccountType.Ledger]: {
    label: 'Ledger',
    bgColor: 'bg-blue-500',
    icon: (props: any) => (
      <img
        src={ledgerLogo}
        alt=""
        className="mr-1 w-5 h-5 group-hover:brightness-110 transition-all duration-300"
        style={{
          filter:
            'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
        }}
        {...props}
      />
    ),
  },
} as const;

const ManageAccountsView = React.memo(() => {
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeAccountRef = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { navigate, alert } = useUtils();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const location = useLocation();

  // Ref for the scrollable ul element
  const scrollContainerRef = useRef<HTMLUListElement>(null);

  // Track if we've already restored scroll position to prevent duplicate restoration
  const hasRestoredScrollRef = useRef(false);

  // Custom scroll restoration for the ul element
  useEffect(() => {
    if (
      location.state?.scrollPosition !== undefined &&
      !hasRestoredScrollRef.current
    ) {
      // Small delay to ensure the component has rendered before scrolling
      if (scrollContainerRef.current) {
        hasRestoredScrollRef.current = true;
        scrollContainerRef.current.scrollTop = location.state.scrollPosition;
      }
    }
  }, [location.state]);

  // State for confirmation dialog
  const [accountToRemove, setAccountToRemove] = useState<{
    account: IKeyringAccountState;
    accountType: KeyringAccountType;
  } | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const editAccount = useCallback(
    (account: IKeyringAccountState) => {
      // Create navigation context with scroll position from the ul element
      const scrollPosition = scrollContainerRef.current?.scrollTop || 0;

      const returnContext = {
        returnRoute: '/settings/manage-accounts',
        scrollPosition,
      };

      navigateWithContext(
        navigate,
        '/settings/edit-account',
        account,
        returnContext
      );
    },
    [navigate]
  );

  const handleClose = useCallback(() => {
    navigate('/home');
  }, [navigate]);

  const isActiveAccount = useCallback(
    (account: IKeyringAccountState, type: KeyringAccountType) =>
      activeAccountRef?.id === account.id && activeAccountRef?.type === type,
    [activeAccountRef?.id, activeAccountRef?.type]
  );

  // Memoize total accounts calculation
  const totalAccounts = useMemo(
    () =>
      Object.values(accounts).reduce(
        (total, typeAccounts) => total + Object.keys(typeAccounts).length,
        0
      ),
    [accounts]
  );

  // Check if account can be removed
  const canRemoveAccount = useCallback(
    (account: IKeyringAccountState, accountType: KeyringAccountType) => {
      // Don't allow removing active account
      if (isActiveAccount(account, accountType)) return false;

      // Check if this is the last account overall
      if (totalAccounts <= 1) return false;

      // For HD accounts, must keep at least one
      if (accountType === KeyringAccountType.HDAccount) {
        const hdAccountsCount = Object.keys(accounts.HDAccount).length;
        if (hdAccountsCount <= 1) return false;
      }

      return true;
    },
    [accounts, isActiveAccount, totalAccounts]
  );

  const handleRemoveClick = useCallback(
    (account: IKeyringAccountState, accountType: KeyringAccountType) => {
      setAccountToRemove({ account, accountType });
    },
    []
  );

  const handleConfirmRemove = useCallback(async () => {
    if (!accountToRemove) return;

    setIsRemoving(true);
    try {
      await controllerEmitter(
        ['wallet', 'removeAccount'],
        [accountToRemove.account.id, accountToRemove.accountType]
      );

      alert.success(t('settings.accountRemovedSuccessfully'));
      setAccountToRemove(null);
    } catch (error: any) {
      alert.error(error.message || t('settings.failedToRemoveAccount'));
    } finally {
      setIsRemoving(false);
    }
  }, [accountToRemove, alert, t]);

  const handleCancelRemove = useCallback(() => {
    setAccountToRemove(null);
  }, []);

  // Memoized unified account rendering
  const renderAccount = useCallback(
    (account: IKeyringAccountState, accountType: KeyringAccountType) => {
      const config = ACCOUNT_TYPE_CONFIG[accountType];
      const IconComponent = config.icon;

      return (
        <li
          key={`${accountType}-${account.id}`}
          className="group my-3 py-2 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default"
        >
          <div className="flex items-center">
            <span
              style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
              className="w-max flex items-center justify-start whitespace-nowrap overflow-hidden"
            >
              <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                <IconComponent />
              </div>
              {account.label} ({ellipsis(account.address, 4, 4)})
            </span>
            <span
              className={`text-xs ml-2 px-2 py-0.5 text-white ${config.bgColor} rounded-full`}
            >
              {config.label}
            </span>
            {isActiveAccount(account, accountType) && (
              <Icon name="greenCheck" isSvg className="ml-2 w-4" />
            )}
          </div>

          <div className="flex gap-x-2 items-center justify-between">
            <IconButton
              onClick={() => editAccount(account)}
              type="primary"
              shape="circle"
            >
              <Icon
                name="edit"
                size={20}
                className="hover:text-brand-royalblue text-xl"
              />
            </IconButton>

            {canRemoveAccount(account, accountType) && (
              <IconButton
                onClick={() => handleRemoveClick(account, accountType)}
                type="primary"
                shape="circle"
                className="hover:bg-red-500 hover:bg-opacity-20"
              >
                <Icon
                  name="delete"
                  size={20}
                  className="hover:text-red-500 text-xl"
                />
              </IconButton>
            )}
          </div>
        </li>
      );
    },
    [editAccount, isActiveAccount, canRemoveAccount, handleRemoveClick]
  );

  // Memoize the account list computation
  const accountsList = useMemo(
    () =>
      Object.entries(accounts).flatMap(([accountType, accountsOfType]) =>
        Object.values(accountsOfType || {}).map((account) => ({
          account: account as IKeyringAccountState,
          accountType: accountType as KeyringAccountType,
        }))
      ),
    [accounts]
  );

  return (
    <>
      <ul
        ref={scrollContainerRef}
        className="remove-scrollbar mb-4 w-full h-80 text-sm overflow-auto md:h-96"
      >
        {accountsList.map(({ account, accountType }) =>
          renderAccount(account, accountType)
        )}
      </ul>
      <div className="w-full px-4 absolute bottom-12 md:static">
        <NeutralButton type="button" fullWidth onClick={handleClose}>
          {t('buttons.close')}
        </NeutralButton>
      </div>

      {/* Confirmation Modal */}
      {accountToRemove && (
        <ConfirmationModal
          show={true}
          onClose={handleCancelRemove}
          onClick={handleConfirmRemove}
          title={t('settings.removeAccount')}
          description={t('settings.removeAccountConfirmation', {
            accountName: accountToRemove.account.label,
            accountType: ACCOUNT_TYPE_CONFIG[accountToRemove.accountType].label,
          })}
          buttonText={t('buttons.remove')}
          isButtonLoading={isRemoving}
        />
      )}
    </>
  );
});

ManageAccountsView.displayName = 'ManageAccountsView';

export default ManageAccountsView;
