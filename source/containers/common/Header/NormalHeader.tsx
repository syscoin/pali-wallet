// @ts-ignore
import React, { FC, useEffect, useState } from 'react';
import { Icon, IconButton } from 'components/index';
import {
  useStore,
  useAccount,
  useUtils,
  useController,
  useBrowser,
} from 'hooks/index';
import { Disclosure, Menu, Transition } from '@headlessui/react';

interface INormalHeader {
  importSeed: boolean;
  isUnlocked?: boolean;
}

export const NormalHeader: FC<INormalHeader> = ({ importSeed }) => {
  const controller = useController();

  const {
    activeNetwork,
    encriptedMnemonic,
    networks,
    activeNetworkType,
    activeChainId,
  } = useStore();
  const { handleRefresh, navigate, getHost } = useUtils();
  const { activeAccount } = useAccount();
  const { browser } = useBrowser();

  const [isConnected, setIsConnected] = useState<any>(null);
  const [currentTabURL, setCurrentTabURL] = useState<any>(null);

  const handleChangeNetwork = (value: number) => {
    controller.wallet.switchNetwork(value as number);
    controller.wallet.getNewAddress();
  };

  useEffect(() => {
    browser.windows.getAll({ populate: true }).then((windows) => {
      for (const window of windows) {
        const views = browser.extension.getViews({ windowId: window.id });

        if (views) {
          browser.tabs
            .query({ active: true, currentWindow: true })
            .then((tabs) => {
              setCurrentTabURL(String(tabs[0].url));
            });

          return;
        }
      }
    });
  }, [!controller.wallet.isLocked()]);

  useEffect(() => {
    if (activeAccount && activeAccount.connectedTo.length > 0) {
      setIsConnected(
        activeAccount.connectedTo.findIndex(
          (url: any) => url === getHost(currentTabURL)
        ) > -1
      );
    }
  }, [activeAccount, currentTabURL]);

  // const ethNetworks = {
  //   main: {
  //     id: 'eth main',
  //     label: 'Main Network',
  //     beUrl: 'https://blockbook.elint.services/',
  //   },
  //   localhost: {
  //     id: 'localhost',
  //     label: 'Localhost 8545',
  //     beUrl: 'https://blockbook-dev.elint.services/',
  //   },
  // };

  const NetworkMenu = () => (
    <Menu
      as="div"
      className="align-center absolute left-2 inline-block mr-8 text-left"
    >
      {(menuprops) => (
        <>
          <Menu.Button className="inline-flex justify-center w-full text-white text-sm font-medium hover:bg-opacity-30 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
            <div className="flex gap-x-5 items-center justify-start ml-2 w-full cursor-pointer">
              <div className="flex items-center">
                <div
                  className="mr-3 px-2 text-brand-white border rounded-full"
                  style={{ borderColor: 'rgb(46 98 183)' }}
                >
                  <span style={{ fontSize: '0.65rem' }}>
                    {activeNetworkType === 'syscoin'
                      ? 'syscoin'
                      : activeNetworkType === 'web3'
                      ? 'web3'
                      : 'polygon'}
                  </span>
                </div>
                <div>
                  <span style={{ textTransform: 'capitalize' }}>
                    {activeNetwork}
                  </span>
                </div>
              </div>

              <div
                id="badge-connected-status"
                className={
                  isConnected
                    ? 'rounded-full text-xs w-28 h-5 flex justify-center items-center border border-warning-success bg-warning-success text-brand-white'
                    : 'rounded-full text-xs w-28 h-5 flex justify-center items-center border bg-warning-error border-warning-error text-brand-white'
                }
              >
                {isConnected ? 'connected' : 'not connected'}
              </div>

              <IconButton className="mb-1">
                <Icon
                  name="select-down"
                  className={`${
                    menuprops.open ? 'transform rotate-180' : ''
                  } text-brand-white`}
                  id="network-settings-btn"
                />
              </IconButton>
            </div>
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
            <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

            <Menu.Items
              as="div"
              className="scrollbar-styled absolute z-10 left-0 pb-6 w-72 h-menu text-center text-brand-white font-poppins bg-menu-primary rounded-2xl focus:outline-none shadow-2xl overflow-auto origin-top-right ring-1 ring-black ring-opacity-5"
            >
              <h2
                className="mb-6 pb-6 pt-8 w-full text-center text-brand-white bg-menu-primary border-b border-dashed border-dashed-light"
                id="network-settings-title"
              >
                NETWORK SETTINGS
              </h2>

              <Menu.Item>
                <li
                  onClick={() => navigate('/networks-sites')}
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
                  onClick={() => navigate('/networks-trusted')}
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

                        <span className="px-3 text-base">Syscoin networks</span>

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
                              className="backface-visibility-hidden flex flex-col items-center justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                              onClick={() =>
                                handleChangeNetwork(currentNetwork.chainId)
                              }
                            >
                              <span>{currentNetwork.label}</span>

                              {activeChainId === currentNetwork.chainId && (
                                <Icon
                                  name="check"
                                  className="mb-1 w-4"
                                  wrapperClassname="w-6 absolute right-1"
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

                        <span className="px-3 text-base">
                          Ethereum networks
                        </span>

                        <Icon
                          name="select-down"
                          className={`${
                            open ? 'transform rotate-180' : ''
                          } mb-1 text-brand-white`}
                        />
                      </Disclosure.Button>

                      <Disclosure.Panel className="pb-2 pt-0.5 text-sm bg-menu-secondary">
                        {Object.values(networks.web3).map(
                          (currentNetwork: any) => (
                            <li
                              key={currentNetwork.chainId}
                              className="backface-visibility-hidden flex flex-col items-center justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                              onClick={() =>
                                handleChangeNetwork(currentNetwork.chainId)
                              }
                            >
                              <span>{currentNetwork.label}</span>

                              {activeChainId === currentNetwork.chainId && (
                                <Icon
                                  name="check"
                                  className="mb-1 w-4"
                                  wrapperClassname="w-6 absolute right-1"
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

                        <span className="px-3 text-base">Polygon networks</span>

                        <Icon
                          name="select-down"
                          className={`${
                            open ? 'transform rotate-180' : ''
                          } mb-1 text-brand-white`}
                        />
                      </Disclosure.Button>

                      <Disclosure.Panel className="pb-2 pt-0.5 text-sm bg-menu-secondary">
                        {Object.values(networks.polygon).map(
                          (currentNetwork: any) => (
                            <li
                              key={currentNetwork.chainId}
                              className="backface-visibility-hidden flex flex-col items-center justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                              onClick={() =>
                                handleChangeNetwork(currentNetwork.chainId)
                              }
                            >
                              <span>{currentNetwork.label}</span>

                              {activeChainId === currentNetwork.chainId && (
                                <Icon
                                  name="check"
                                  className="mb-1 w-4"
                                  wrapperClassname="w-6 absolute right-1"
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
                  onClick={() => handleChangeNetwork(0)}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="home" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Localhost 8545</span>

                  {activeNetwork === 'localhost' && (
                    <Icon
                      name="check"
                      className="mb-1 w-4"
                      wrapperClassname="w-6"
                    />
                  )}
                </li>
              </Menu.Item>

              <Menu.Item>
                <li
                  onClick={() => navigate('/networks-custom')}
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
                  onClick={() => navigate('/networks-edit')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="edit" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Edit networks</span>
                </li>
              </Menu.Item>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );

  const GeneralMenu = () => (
    <Menu as="div" className="absolute z-10 right-2 inline-block text-right">
      {() => (
        <>
          <Menu.Button
            as="button"
            id="general-settings-button"
            className="mb-2 mr-0.8"
          >
            {encriptedMnemonic && !importSeed ? (
              <IconButton type="primary" shape="circle">
                <Icon
                  name="settings"
                  className="z-0 hover:text-brand-royalblue text-brand-white"
                />
              </IconButton>
            ) : null}
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
            <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

            <Menu.Items
              as="div"
              className="scrollbar-styled absolute z-10 right-0 pb-6 w-72 h-96 text-center text-brand-white font-poppins bg-menu-primary rounded-2xl focus:outline-none shadow-2xl overflow-auto origin-top-right ring-1 ring-black ring-opacity-5"
            >
              <h2
                className="mb-6 pb-6 pt-8 w-full text-center text-brand-white bg-menu-primary border-b border-dashed border-dashed-light"
                id="general-settings-title"
              >
                GENERAL SETTINGS
              </h2>

              <Menu.Item>
                <li
                  onClick={() => navigate('/general-autolock')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="clock" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Auto lock timer</span>
                </li>
              </Menu.Item>

              <Menu.Item>
                <li
                  onClick={() => navigate('/general-currency')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="dolar" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Currency</span>
                </li>
              </Menu.Item>

              <Menu.Item>
                <li
                  onClick={() => navigate('/general-phrase')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="wallet" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Wallet Seed Phrase</span>
                </li>
              </Menu.Item>

              <Menu.Item>
                <li
                  onClick={() => navigate('/general-about')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="warning" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Info/Help</span>
                </li>
              </Menu.Item>

              <Menu.Item>
                <li
                  onClick={() => navigate('/general-delete')}
                  className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
                >
                  <Icon name="delete" className="ml-1 mr-4 text-brand-white" />

                  <span className="px-3">Delete wallet</span>
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

      <IconButton
        onClick={handleRefresh}
        className="absolute right-10 hover:text-brand-deepPink100 text-brand-white"
      >
        <Icon name="reload" wrapperClassname="mb-2 mr-2" />
      </IconButton>

      <GeneralMenu />
    </div>
  );
};
