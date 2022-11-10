import { Disclosure, Menu, Transition } from '@headlessui/react';
import { uniqueId } from 'lodash';
import React from 'react';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import { INetwork } from '@pollum-io/sysweb3-utils';

import { Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const NetworkMenu: React.FC = () => {
  const { wallet } = getController();

  const networks = useSelector((state: RootState) => state.vault.networks);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const { navigate } = useUtils();

  const handleChangeNetwork = (network: INetwork, chain: string) => {
    try {
      wallet
        .setActiveNetwork(network, chain)
        .then(({ networkVersion, chainId }: any) => {
          browser.runtime.sendMessage({
            type: 'CHAIN_CHANGED',
            data: { networkVersion, chainId },
          });
        });
    } catch (networkError) {
      navigate('/home');
    }
  };
  return (
    <Menu as="div" className="absolute left-2 inline-block mr-8 text-left">
      {(menuprops) => (
        <>
          <Menu.Button className="inline-flex gap-x-2 items-center justify-start ml-2 w-full text-white text-sm font-medium hover:bg-opacity-30 rounded-full focus:outline-none cursor-pointer">
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
            enterTo="opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
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

                        <Disclosure.Panel className="h-max pb-2 pt-0.5 text-sm bg-menu-secondary">
                          {Object.values(networks.syscoin).map(
                            (currentNetwork: INetwork) => (
                              <li
                                key={uniqueId()}
                                className="backface-visibility-hidden flex flex-col justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                                onClick={() =>
                                  handleChangeNetwork(currentNetwork, 'syscoin')
                                }
                              >
                                <span className="ml-8 text-left">
                                  {currentNetwork.label}
                                </span>

                                {isBitcoinBased &&
                                  activeNetwork.chainId ===
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

                        <Disclosure.Panel className="h-max pb-2 pt-0.5 text-sm bg-menu-secondary">
                          {Object.values(networks.ethereum).map(
                            (currentNetwork: any) => (
                              <li
                                key={uniqueId()}
                                className="backface-visibility-hidden flex flex-col justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                                onClick={() =>
                                  handleChangeNetwork(
                                    currentNetwork,
                                    'ethereum'
                                  )
                                }
                              >
                                <span className="ml-8 text-left">
                                  {currentNetwork.label}
                                </span>

                                {!isBitcoinBased &&
                                  activeNetwork.chainId ===
                                    currentNetwork.chainId && (
                                    <Icon
                                      name="check"
                                      className="mb-1 w-4"
                                      wrapperClassname="w-6 absolute right-16"
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
};
