import { Menu } from '@headlessui/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

import RenderAccountsListByBitcoinBased from './RenderAccountsListByBitcoinBased';

export const AccountMenu: React.FC = () => {
  const { navigate } = useUtils();
  const { controllerEmitter } = useController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const url = chrome.runtime.getURL('app.html');
  const { t } = useTranslation();
  const setActiveAccount = async (id: number, type: KeyringAccountType) => {
    if (!isBitcoinBased) {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const host = new URL(tabs[0].url).hostname;

      await controllerEmitter(['dapp', 'getAccount'], [host]).then(
        async (res) => {
          await controllerEmitter(
            ['wallet', 'setAccount'],
            [Number(id), type, host, res]
          );
        }
      );

      return;
    }

    await controllerEmitter(['wallet', 'setAccount'], [Number(id), type]);
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
          onClick={() => navigate('/settings/account/new')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="AddUser" isSvg className="mb-1 text-brand-white" />

          <span>{t('accountMenu.createNewAccount')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/manage-accounts')}
          className="py-1.5 cursor-pointer pl-5 pr-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="ManageUser" isSvg className="mb-2 text-brand-white" />

          <span>{t('accountMenu.manageAccounts')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/account/private-key')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="key" className="mb-2 text-brand-white" />

          <span>{t('accountMenu.yourKeys')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => window.open(url)}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon
            name="HardWallet"
            isSvg
            className="mb-2 text-brand-white"
            id="hardware-wallet-btn"
          />

          <span>{t('accountMenu.connectTrezor')}</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <div className="flex flex-col gap-2">
          <li
            onClick={() => navigate('/settings/account/import')}
            className={`py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center justify-start gap-3 text-white text-sm font-medium active:bg-opacity-40 focus:outline-none`}
          >
            <Icon name="ImportUser" isSvg className="mb-1 text-brand-white" />

            <span>{t('accountMenu.importAccount')}</span>
          </li>
        </div>
      </Menu.Item>
    </div>
  );
};

export default AccountMenu;
