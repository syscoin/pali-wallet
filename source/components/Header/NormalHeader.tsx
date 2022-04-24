import React, { useEffect, useState } from 'react';
import { Icon, Tooltip } from 'components/index';
import { useStore, useUtils } from 'hooks/index';
import { ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import { Badge } from 'antd';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { browser } from 'webextension-polyfill-ts';

export const NormalHeader: React.FC = () => {
  const { wallet } = getController();

  const { activeNetwork, encryptedMnemonic, networks } = useStore();
  const { handleRefresh, navigate } = useUtils();

  const [currentTabURL, setCurrentTabURL] = useState<string>('');

  const handleChangeNetwork = (chain: string, chainId: number) => {
    wallet.setActiveNetwork(chain, chainId);

    if (chain === 'syscoin') wallet.account.sys.setAddress();
  };

  const updateCurrentTabUrl = async () => {
    const windows = await browser.windows.getAll({ populate: true });

    for (const window of windows) {
      const views = browser.extension.getViews({ windowId: window.id });

      if (views) {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        setCurrentTabURL(String(tabs[0].url));
        return;
      }
    }
  };

  useEffect(() => {
    updateCurrentTabUrl();
  }, [wallet.isUnlocked()]);

  const NetworkMenu = () => (
    <Menu as="div" className="absolute left-2 inline-block mr-8 text-left">
      {(menuprops) => (
        <>
          <Menu.Button className="z-0 inline-flex gap-x-2 items-center justify-start ml-2 w-full text-white text-sm font-medium hover:bg-opacity-30 rounded-full focus:outline-none cursor-pointer">
            <span>{activeNetwork.label}</span>

            <Icon
              name="select-down"
              className={`${
                menuprops.open ? 'transform rotate-180' : ''
              } text-brand-white`}
              id="network-settings-btn"
            />
          </Menu.Button>

          <Transition
            as="div"
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
            className="z-40"
          >
            <div className="fixed z-50 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

            <Menu.Items
              as="div"
              className="absolute z-50 left-0 pb-6 w-72 h-menu text-center text-brand-white font-poppins bg-menu-primary rounded-2xl focus:outline-none shadow-2xl overflow-hidden origin-top-right ring-1 ring-black ring-opacity-5"
            >
              <h2
                className="mb-6 pb-6 pt-8 w-full text-center text-brand-white bg-menu-primary border-b border-dashed border-dashed-light"
                id="network-settings-title"
              >
                NETWORK SETTINGS
              </h2>
              <div className="scrollbar-styled h-80 overflow-auto">
                <Menu.Item>
                  <li
                    onClick={() =>
                      navigate('/settings/networks/connected-sites')
                    }
                    className="flex items-center justify-start mb-2 mx-3 px-2 py-1 text-base bg-warning-success hover:bg-opacity-70 border border-solid border-transparent hover:border-warning-success rounded-full cursor-pointer transition-all duration-200"
                  >
                    <Icon
                      name="globe"
                      className="mb-1 ml-1 mr-4 text-brand-white"
                    />

                    <span className="px-3">Connected sites</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => navigate('/settings/networks/trusted-sites')}
                    className="flex items-center justify-start mb-4 mx-3 px-2 py-1 text-base bg-brand-royalblue hover:bg-opacity-70 border border-solid border-brand-royalblue rounded-full cursor-pointer transition-all duration-200"
                  >
                    <Icon
                      name="warning"
                      className="mb-1 ml-1 mr-4 text-brand-white"
                    />

                    <span className="px-3">Trusted sites</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <Disclosure>
                    {({ open }) => (
                      <>
                        <Disclosure.Button className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200">
                          <Icon
                            name="dolar"
                            className="ml-1 mr-4 text-brand-white"
                          />

                          <span className="px-3 text-base">Syscoin core</span>

                          <Icon
                            name="select-down"
                            className={`${
                              open ? 'transform rotate-180' : ''
                            } text-brand-white mb-1`}
                          />
                        </Disclosure.Button>

                        <Disclosure.Panel className="scrollbar-styled pb-2 pt-0.5 h-28 text-sm bg-menu-secondary overflow-auto">
                          {Object.values(networks.syscoin).map(
                            (currentNetwork: any) => (
                              <li
                                key={currentNetwork.chainId}
                                className="backface-visibility-hidden flex flex-col justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                                onClick={() =>
                                  handleChangeNetwork(
                                    'syscoin',
                                    currentNetwork.chainId
                                  )
                                }
                              >
                                <span className="ml-8 text-left">
                                  {currentNetwork.label}
                                </span>

                                {activeNetwork.chainId ===
                                  currentNetwork.chainId && (
                                  <Icon
                                    name="check"
                                    className="mb-1 w-4"
                                    wrapperClassname="w-6 absolute right-20"
                                  />
                                )}
                              </li>
                            )
                          )}
                        </Disclosure.Panel>
                      </>
                    )}
                  </Disclosure>
                </Menu.Item>

                <Menu.Item>
                  <Disclosure>
                    {({ open }) => (
                      <>
                        <Disclosure.Button className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200">
                          <Icon
                            name="dolar"
                            className="ml-1 mr-4 text-brand-white"
                          />

                          <span className="px-3 text-base">Web3 networks</span>

                          <Icon
                            name="select-down"
                            className={`${
                              open ? 'transform rotate-180' : ''
                            } mb-1 text-brand-white`}
                          />
                        </Disclosure.Button>

                        <Disclosure.Panel className="scrollbar-styled pb-2 pt-0.5 h-28 text-sm bg-menu-secondary overflow-auto">
                          {Object.values(networks.ethereum).map(
                            (currentNetwork: any) => (
                              <li
                                key={currentNetwork.id}
                                className="backface-visibility-hidden flex flex-col justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                                onClick={() =>
                                  handleChangeNetwork(
                                    'ethereum',
                                    currentNetwork.chainId
                                  )
                                }
                              >
                                <span className="ml-8 text-left">
                                  {currentNetwork.label}
                                </span>

                                {activeNetwork.chainId ===
                                  currentNetwork.chainId && (
                                  <Icon
                                    name="check"
                                    className="mb-1 w-4"
                                    wrapperClassname="w-6 absolute right-20"
                                  />
                                )}
                              </li>
                            )
                          )}
                        </Disclosure.Panel>
                      </>
                    )}
                  </Disclosure>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => navigate('/settings/networks/custom-rpc')}
                    className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                  >
                    <Icon
                      name="appstoreadd"
                      className="ml-1 mr-4 text-brand-white"
                    />

                    <span className="px-3">Custom RPC</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => navigate('/settings/networks/edit')}
                    className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                  >
                    <Icon name="edit" className="ml-1 mr-4 text-brand-white" />

                    <span className="px-3">Manage networks</span>
                  </li>
                </Menu.Item>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );

  const GeneralMenu = () => (
    <Menu
      as="div"
      className="absolute right-2 top-2 flex items-center justify-evenly"
    >
      {() => (
        <>
          <Tooltip content={ellipsis(currentTabURL, 25, 0)}>
            <div
              onClick={() => navigate('/settings/networks/connected-sites')}
              className="relative z-0 mx-1.5 text-brand-white cursor-pointer"
            >
              <Icon
                name="globe"
                className="hover:text-brand-royalblue text-white"
              />

              <Badge className="s absolute -right-1 top-1 w-3 h-3 text-warning-error bg-warning-error rounded-full" />
            </div>
          </Tooltip>

          <div
            onClick={() => handleRefresh(false)}
            className="z-0 mx-1.5 hover:text-brand-royalblue text-brand-white cursor-pointer"
          >
            <Icon name="reload" />
          </div>

          <Menu.Button
            as="button"
            id="general-settings-button"
            className="z-0 mx-1.5"
          >
            {Boolean(encryptedMnemonic) && (
              <div>
                <Icon
                  name="settings"
                  className="hover:text-brand-royalblue text-brand-white"
                />
              </div>
            )}
          </Menu.Button>

          <Transition
            as="div"
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <div className="fixed z-40 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

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
                  onClick={() => navigate('/settings/currency')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="dolar" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Currency</span>
                </li>
              </Menu.Item>

              <Menu.Item>
                <li
                  onClick={() => navigate('/settings/phrase')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon
                    name="wallet"
                    className="ml-1 mr-4 text-brand-white"
                    id="wallet-seed-phrase-btn"
                  />

                  <span className="px-3">Wallet Seed Phrase</span>
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
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );

  return (
    <div className="relative flex items-center justify-between p-2 py-6 w-full text-gray-300 bg-bkg-1">
      <NetworkMenu />

      <GeneralMenu />
    </div>
  );
};
