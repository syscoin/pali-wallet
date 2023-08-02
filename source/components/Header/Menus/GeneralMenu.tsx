import { Menu, Transition } from '@headlessui/react';
import { Badge } from 'antd';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import eth from 'assets/images/eth.png';
import slider from 'assets/images/sliderIcon.png';
import { Icon, Tooltip } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { truncate, getHost } from 'utils/index';

export const GeneralMenu: React.FC = () => {
  const { wallet, dapp, refresh } = getController();

  const {
    changingConnectedAccount: { isChangingConnectedAccount },
    advancedSettings,
  } = useSelector((state: RootState) => state.vault);

  const { navigate } = useUtils();

  const [currentTab, setCurrentTab] = useState({
    host: '',
    isConnected: false,
  });
  const className = currentTab.isConnected ? 'success' : 'error';

  const getTabUrl = async () => {
    const windows = await browser.windows.getAll({ populate: true });

    for (const window of windows) {
      const views = browser.extension.getViews({ windowId: window.id });

      if (views) {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });

        return String(tabs[0].url);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    getTabUrl().then(async (url: string) => {
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
      getTabUrl().then(async (url: string) => {
        const host = getHost(url);
        const isConnected = dapp.isConnected(host);

        setCurrentTab({ host, isConnected });
      });
    }
  }, [isChangingConnectedAccount]);

  return (
    <Menu
      as="div"
      className="absolute right-2 top-2 flex items-center justify-evenly"
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
          className="scrollbar-styled absolute z-50 right-0 pb-6 w-72 h-96 text-center text-brand-white font-poppins bg-menu-primary rounded-2xl focus:outline-none shadow-2xl overflow-auto origin-top-right ring-1 ring-black ring-opacity-5"
        >
          <h2
            className="mb-6 pb-6 pt-8 w-full text-center text-brand-white bg-menu-primary border-b border-dashed border-dashed-light"
            id="general-settings-title"
          >
            GENERAL SETTINGS
          </h2>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/autolock')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon name="clock" className="ml-1 mr-4 text-brand-white" />

              <span className="px-3">Auto lock timer</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/remove-eth')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <img
                src={eth}
                width="23px"
                height="23px"
                className="ml-0.2 mr-3 text-brand-white"
              />

              <span className="px-3">Manage ETH provider</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/currency')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon name="dolar" className="ml-1 mr-4 text-brand-white" />

              <span className="px-3">Currency</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/seed')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon name="wallet" className="ml-1 mr-4 text-brand-white" />

              <span id="wallet-seed-phrase-btn" className="px-3">
                Wallet Seed Phrase
              </span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/about')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon
                name="warning"
                className="ml-1 mr-4 text-brand-white"
                id="info-help-btn"
              />

              <span className="px-3">Info/Help</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/forget-wallet')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon
                name="forget"
                className="ml-1 mr-4 w-5 h-5 text-brand-white"
                id="forget-wallet-btn"
              />

              <span className="px-3">Forget wallet</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/advanced')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <img
                src={slider}
                width="23px"
                height="23px"
                className="ml-1 mr-3 text-brand-white"
              />

              <span className="px-3">Advanced</span>
            </li>
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );
};
