import { Menu, Transition } from '@headlessui/react';
import { Badge } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import slider from 'assets/images/sliderIcon.png';
import { Icon, Tooltip, AccountMenu } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate, getHost, getTabUrl } from 'utils/index';

export const GeneralMenu: React.FC = () => {
  const { wallet, dapp, refresh } = getController();

  const {
    changingConnectedAccount: { isChangingConnectedAccount },
    advancedSettings,
  } = useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const { navigate } = useUtils();

  const [currentTab, setCurrentTab] = useState({
    host: '',
    isConnected: false,
  });
  const className = currentTab.isConnected ? 'success' : 'error';

  const handleLogout = () => {
    wallet.lock();

    navigate('/');
  };

  useEffect(() => {
    let isMounted = true;

    getTabUrl(browser).then(async (url: string) => {
      if (!isMounted) return;

      const host = getHost(url);
      const isConnected = dapp.isConnected(host);

      setCurrentTab({ host, isConnected });
    });

    return () => {
      isMounted = false;
    };
  }, [wallet.isUnlocked()]);

  useEffect(() => {
    if (!isChangingConnectedAccount) {
      getTabUrl(browser).then(async (url: string) => {
        const host = getHost(url);
        const isConnected = dapp.isConnected(host);

        setCurrentTab({ host, isConnected });
      });
    }
  }, [isChangingConnectedAccount]);

  return (
    <Menu
      as="div"
      className="absolute right-4 top-2 flex items-center gap-2 justify-evenly"
    >
      <Tooltip content={truncate(currentTab.host)}>
        <div
          onClick={() => navigate('/settings/networks/connected-sites')}
          className="relative mx-1.5 text-brand-white cursor-pointer"
        >
          <Icon
            name="globe"
            className="hover:text-brand-royalblue text-white"
          />

          <Badge
            className={`absolute -right-1 top-1.2 w-3 h-3 text-warning-${className} bg-warning-${className} rounded-full`}
          />
        </div>
      </Tooltip>

      {advancedSettings['refresh'] && (
        <div
          onClick={() => refresh()}
          className="mx-1.5 hover:text-brand-royalblue text-brand-white cursor-pointer"
        >
          <Icon name="reload" />
        </div>
      )}

      <Menu.Button as="button" className="mx-1.5">
        <div id="general-settings-button">
          <Icon
            name="hamburger-menu"
            className="hover:text-brand-royalblue text-brand-white"
          />
        </div>
      </Menu.Button>

      <Transition
        as="div"
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <div className="fixed z-50 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

        <Menu.Items
          as="div"
          className="scrollbar-styled absolute z-50 top-6 right-[-16px] pb-24 w-screen h-screen text-center text-brand-white font-poppins bg-brand-blue600 rounded-2xl focus:outline-none shadow-2xl overflow-auto  ring-1 ring-black ring-opacity-5"
        >
          <AccountMenu />
          <div className="flex flex-col justify-start items-start">
            <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
              {t('generalMenu.wallet')}
            </span>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/remove-eth')}
                className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon
                  name="PaliWhiteSmall"
                  isSvg
                  className="text-brand-white"
                />

                <span>{t('generalMenu.manageEth')}</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/seed')}
                className="py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden gap-2 flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon name="Key" isSvg className="mb-1 text-brand-white" />

                <span id="wallet-seed-phrase-btn">
                  {t('generalMenu.walletSeedPhrase')}
                </span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/forget-wallet')}
                className="py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden gap-2 flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon
                  name="Trash"
                  isSvg
                  className="mb-1 text-brand-white"
                  id="forget-wallet-btn"
                />

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
                onClick={() => navigate('/settings/languages')}
                className="py-1.5 gap-2 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon
                  name="Language"
                  isSvg
                  className="mb-1 text-brand-white"
                  id="forget-wallet-btn"
                  wrapperClassname={`max-w-10`}
                />

                <span>{t('generalMenu.languages')}</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/currency')}
                className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon
                  name="DollarSign"
                  isSvg
                  className="text-brand-white"
                  wrapperClassname={`max-w-10`}
                />

                <span>{t('generalMenu.currency')}</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/autolock')}
                className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon name="Clock" isSvg className="text-brand-white" />

                <span>{t('generalMenu.autolock')}</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/about')}
                className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon
                  name="Help"
                  isSvg
                  className="text-brand-white"
                  id="info-help-btn"
                />

                <span>{t('generalMenu.infoHelp')}</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={handleLogout}
                className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <Icon name="Lock" isSvg className="mb-2 text-brand-white" />

                <span>{t('generalMenu.lock')}</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={() => navigate('/settings/advanced')}
                className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
              >
                <img src={slider} width="20px" className="text-brand-white" />

                <span>{t('generalMenu.advanced')}</span>
              </li>
            </Menu.Item>
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
};
