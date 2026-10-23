import { Menu } from '@headlessui/react';
import { Badge } from 'antd';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import slider from 'assets/all_assets/sliderIcon.png';
import {
  KeySvg,
  PaliWhiteSmallIconSvg,
  TrashIconSvg,
  LanguageIconSvg,
  DollarSignIconSvg,
  HelpIconSvg,
  LockIconSvg,
} from 'components/Icon/Icon';
import { Icon, Tooltip, AccountMenu } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { getDappOrigin } from 'utils/dappOrigin';
import { truncate } from 'utils/index';
import {
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

const MENU_ITEM_CLASS_NAME =
  'gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200';

interface IGeneralMenuProps {
  disabled?: boolean;
}

export const GeneralMenu: React.FC<IGeneralMenuProps> = ({
  disabled = false,
}) => {
  const location = useLocation();
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { navigate } = useUtils();
  // Narrow field selector: avoids re-rendering the menu on every
  // vault/vaultGlobal mutation (balances, polling flags, etc.)
  const advancedSettings = useSelector(
    (state: RootState) => state.vaultGlobal.advancedSettings
  );

  // Get dapps from Redux state
  const dapps = useSelector((state: RootState) => state.dapp.dapps);

  // Check if there are ANY connected dapps
  const hasAnyConnectedDapps = Object.keys(dapps).length > 0;

  const [currentTab, setCurrentTab] = useState({
    host: '',
    isConnected: false,
  });
  const resetSearchOnOpen = useRef(false);

  // Use hasAnyConnectedDapps OR current tab connection for the icon color
  const className =
    hasAnyConnectedDapps || currentTab.isConnected ? 'success' : 'error';

  const handleSettingsNavigation = (pathname: string) =>
    navigateWithContext(
      navigate,
      pathname,
      {},
      createBrowsingNavigationContext(location)
    );

  const handleLogout = () => {
    controllerEmitter(['wallet', 'lock']);

    navigate('/');
  };

  // Function to check current tab connection status
  const checkTabConnectionStatus = useCallback(async () => {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tabs[0]?.url) {
        const host = getDappOrigin(tabs[0].url) || '';
        const isConnected = !!dapps[host];
        setCurrentTab({ host, isConnected });
      }
    } catch (error) {
      console.error('Error checking tab connection status:', error);
    }
  }, [dapps]);

  useEffect(() => {
    checkTabConnectionStatus();
  }, [checkTabConnectionStatus]);

  // State updates are handled automatically by the background script
  // via CONTROLLER_STATE_CHANGE messages and Redux store updates
  return (
    <Menu
      as="div"
      className="absolute z-[9999] right-4 top-2 flex items-center gap-2 justify-evenly"
    >
      {({ open }) => (
        <>
          <Tooltip content={truncate(currentTab.host)}>
            <button
              type="button"
              aria-label={t('settings.connectedSites')}
              onClick={() =>
                handleSettingsNavigation('/settings/networks/connected-sites')
              }
              className="relative mx-1.5 text-brand-white cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue"
            >
              <Icon
                name="globe"
                className="hover:text-brand-royalblue text-white"
              />

              <Badge
                className={`absolute -right-1 top-1.2 w-3 h-3 text-warning-${className} bg-warning-${className} rounded-full`}
              />
            </button>
          </Tooltip>
          {advancedSettings['refresh'] && (
            <button
              type="button"
              aria-label={t('header.refresh')}
              onClick={() => controllerEmitter(['refresh'], [])}
              className="mx-1.5 hover:text-brand-royalblue text-brand-white cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-brand-royalblue"
            >
              <Icon name="reload" />
            </button>
          )}
          <Menu.Button
            as="button"
            aria-label={t('generalMenu.generalOptions')}
            disabled={disabled}
            onClick={() => {
              resetSearchOnOpen.current = !open;
            }}
            className={`mx-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-royalblue ${
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <div id="general-settings-button">
              <Icon
                name="hamburger-menu"
                className={`${
                  disabled
                    ? 'text-brand-white'
                    : 'hover:text-brand-royalblue text-brand-white'
                }`}
              />
            </div>
          </Menu.Button>

          <div
            className={`fixed z-50 -inset-0 w-full bg-brand-black transition-all duration-300 ease-in-out ${
              open ? 'bg-opacity-50' : 'bg-opacity-0 pointer-events-none'
            }`}
          />

          {!disabled && (
            <Menu.Items
              as="div"
              aria-hidden={!open}
              {...(open ? {} : { inert: '' })}
              onFocusCapture={(event) => {
                if (
                  event.target !== event.currentTarget ||
                  !resetSearchOnOpen.current
                )
                  return;
                resetSearchOnOpen.current = false;
                // Item focus clears Headless UI's retained typeahead without selecting it.
                const menu = event.currentTarget;
                menu
                  .querySelector<HTMLElement>(
                    '[role="menuitem"]:not([aria-disabled="true"])'
                  )
                  ?.focus({ preventScroll: true });
                menu.focus({ preventScroll: true });
              }}
              className={`pali-menu fixed overflow-x-hidden z-50 inset-x-0 top-8 bottom-0 w-full text-center text-brand-white font-poppins bg-brand-blue600 rounded-2xl focus:outline-none shadow-2xl ring-1 ring-black ring-opacity-5
              transform transition-all duration-100 ease-out ${
                open
                  ? 'opacity-100 scale-100 pointer-events-auto'
                  : 'opacity-0 scale-95 pointer-events-none'
              }`}
              unmount={false}
            >
              <div className="remove-scrollbar h-full overflow-y-auto overscroll-contain scroll-py-2 pb-24">
                {open && <AccountMenu />}
                <div className="flex flex-col justify-start items-start">
                  <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
                    {t('generalMenu.wallet')}
                  </span>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/settings/remove-eth')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <PaliWhiteSmallIconSvg className="text-brand-white" />

                      <span>{t('generalMenu.manageEth')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/home/smart-account')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <Icon
                        name="wallet"
                        className="text-brand-white"
                        size={16}
                      />

                      <span id="smart-account-hub-btn">
                        {t('smartAccountHub.menuEntry')}
                      </span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <button
                      type="button"
                      onClick={() =>
                        handleSettingsNavigation('/settings/sentry')
                      }
                      className="menu-action flex min-h-11 w-full items-center gap-2 px-5 text-left text-sm text-white hover:bg-brand-blue500 hover:bg-opacity-20 focus-visible:outline focus-visible:outline-2"
                    >
                      <KeySvg className="text-brand-white" />
                      <span>{t('sentry.sentryOperators')}</span>
                    </button>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() => handleSettingsNavigation('/settings/seed')}
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <KeySvg className="mb-1 text-brand-white" />

                      <span id="wallet-seed-phrase-btn">
                        {t('generalMenu.walletSeedPhrase')}
                      </span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/settings/forget-wallet')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <TrashIconSvg className="mb-1 text-brand-white" />

                      <span>{t('generalMenu.forget')}</span>
                    </li>
                  </Menu.Item>
                </div>
                <div className="flex flex-col justify-start items-start">
                  <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
                    {t('generalMenu.generalOptions')}
                  </span>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/settings/languages')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <div className="max-w-10">
                        <LanguageIconSvg
                          id="language-btn"
                          className="mb-1 text-brand-white"
                        />
                      </div>

                      <span>{t('generalMenu.languages')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/settings/currency')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <DollarSignIconSvg className="text-brand-white" />

                      <span>{t('generalMenu.currency')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/settings/about')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <HelpIconSvg
                        id="info-help-btn"
                        className="text-brand-white"
                      />

                      <span>{t('generalMenu.infoHelp')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li onClick={handleLogout} className={MENU_ITEM_CLASS_NAME}>
                      <LockIconSvg className="mb-2 text-brand-white" />

                      <span>{t('generalMenu.lock')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() =>
                        handleSettingsNavigation('/settings/advanced')
                      }
                      className={MENU_ITEM_CLASS_NAME}
                    >
                      <img
                        src={slider}
                        width="20px"
                        className="text-brand-white"
                      />

                      <span>{t('generalMenu.advanced')}</span>
                    </li>
                  </Menu.Item>
                </div>
              </div>
            </Menu.Items>
          )}
        </>
      )}
    </Menu>
  );
};
