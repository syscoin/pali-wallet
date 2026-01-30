import { Menu } from '@headlessui/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  AddUserSvg,
  ManageUserSvg,
  KeySvg,
  HardWalletIconSvg,
  UserImportedIconSvg,
} from 'components/Icon/Icon';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { KeyringAccountType } from 'types/network';
import {
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

import RenderAccountsListByBitcoinBased from './RenderAccountsListByBitcoinBased';

export const AccountMenu: React.FC = () => {
  const { navigate } = useUtils();
  const { controllerEmitter, handleWalletLockedError } = useController();
  const { t } = useTranslation();
  const activeAccountMeta = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const isHardwareAccount =
    activeAccountMeta?.type === KeyringAccountType.Ledger ||
    activeAccountMeta?.type === KeyringAccountType.Trezor;
  const setActiveAccount = async (id: number, type: KeyringAccountType) => {
    try {
      await controllerEmitter(['wallet', 'setAccount'], [Number(id), type]);
    } catch (error) {
      // Check if this is a wallet locked error and handle redirect
      const wasHandled = handleWalletLockedError(error);
      if (!wasHandled) {
        // If not a wallet locked error, log it but don't show UI error
        // since account switching should be seamless
        console.error('Error switching account:', error);
      }
    }
  };

  return (
    <div className="flex flex-col justify-start items-start">
      <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
        {t('accountMenu.accounts')}
      </span>

      <RenderAccountsListByBitcoinBased setActiveAccount={setActiveAccount} />

      <span className="disabled text-xs flex justify-start px-5 my-3">
        {t('accountMenu.accountsSettings')}
      </span>

      <Menu.Item>
        <li
          onClick={() => {
            const returnContext = createNavigationContext('/home');
            navigateWithContext(
              navigate,
              '/settings/account/new',
              { fromMenu: true },
              returnContext
            );
          }}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
        >
          <AddUserSvg className="mb-1 text-brand-white" />

          <span>{t('accountMenu.createNewAccount')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => {
            const returnContext = createNavigationContext('/home');
            navigateWithContext(
              navigate,
              '/settings/manage-accounts',
              { fromMenu: true },
              returnContext
            );
          }}
          className="py-1.5 cursor-pointer pl-5 pr-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
        >
          <ManageUserSvg className="mb-2 text-brand-white" />

          <span>{t('accountMenu.manageAccounts')}</span>
        </li>
      </Menu.Item>

      {!isHardwareAccount && (
        <Menu.Item>
          <li
            onClick={() => {
              const returnContext = createNavigationContext('/home');
              navigateWithContext(
                navigate,
                '/settings/account/private-key',
                { fromMenu: true },
                returnContext
              );
            }}
            className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
          >
            <KeySvg className="mb-2 text-brand-white" />

            <span>{t('accountMenu.yourKeys')}</span>
          </li>
        </Menu.Item>
      )}

      <Menu.Item>
        <li
          onClick={() => {
            const url = chrome.runtime.getURL(
              'external.html?route=settings/account/hardware'
            );
            window.open(url, '_blank');

            // Set storage flag for detection
            chrome.storage.local.set(
              {
                'pali-popup-open': true,
                'pali-popup-timestamp': Date.now(),
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error(
                    '[AccountMenu] Failed to set popup flag:',
                    chrome.runtime.lastError
                  );
                }
              }
            );
          }}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
        >
          <HardWalletIconSvg className="mb-2 text-brand-white" />

          <span>{t('accountMenu.connectTrezor')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <div className="flex flex-col gap-2">
          <li
            onClick={() => {
              const returnContext = createNavigationContext('/home');
              navigateWithContext(
                navigate,
                '/settings/account/import',
                { fromMenu: true },
                returnContext
              );
            }}
            className={`py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center justify-start gap-3 text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200`}
          >
            <UserImportedIconSvg className="mb-1 text-brand-white" />

            <span>{t('accountMenu.importAccount')}</span>
          </li>
        </div>
      </Menu.Item>
    </div>
  );
};

export default AccountMenu;
