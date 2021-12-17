import React, { FC } from 'react';
import { Icon, IconButton } from 'components/index';
import { useStore, useAccount, useUtils, useController } from 'hooks/index';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { SYS_NETWORK } from 'constants/index';

interface INormalHeader {
  importSeed: boolean;
  isUnlocked?: boolean;
}

export const NormalHeader: FC<INormalHeader> = ({
  importSeed,
}) => {
  const controller = useController();

  const { activeNetwork, encriptedMnemonic } = useStore();
  const { handleRefresh, history } = useUtils();
  const { connectedAccount } = useAccount();

  const network = activeNetwork;

  const handleChangeNetwork = (value: string) => {
    controller.wallet.switchNetwork(value as string);
    controller.wallet.getNewAddress();
  };

  const NetworkMenu = () => {
    return (
      <Menu
        as="div"
        className="absolute left-2 inline-block text-left mr-8"
      >
        {({ open }) => (
          <>
            <Menu.Button
              className="inline-flex justify-center w-full  text-sm font-medium text-white rounded-full hover:bg-opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
            >
              <div
                className="cursor-pointer w-full ml-2 flex items-center justify-start gap-x-6"
              >
                <div
                  className={
                    connectedAccount ?
                      "rounded-full text-xs w-28 h-5 flex justify-center items-center border border-brand-lightgreen bg-brand-lightgreen text-brand-white" :
                      "rounded-full text-xs w-28 h-5 flex justify-center items-center border bg-brand-transparentred border-brand-error text-brand-white"
                  }
                >
                  {connectedAccount ? 'connected' : 'not connected'}
                </div>

                <span>
                  {network}
                </span>

                <IconButton className="mb-1">
                  <Icon name="select-down"
                    className={`${open ? 'transform rotate-180' : ''
                      } text-brand-white`}
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
              <div
                className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
              />

              <Menu.Items
                as="div"
                className="menu bg-brand-navyborder pb-6 overflow-auto text-brand-white font-poppins shadow-2xl absolute z-10 left-0 h-96 origin-top-right rounded-2xl ring-1 ring-black ring-opacity-5 focus:outline-none text-center w-72"
              >
                <h2
                  className=" bg-brand-navydarker pt-8 pb-6 text-brand-white border-b border-dashed border-yellow-300 w-full text-center mb-6"
                >
                  NETWORK SETTINGS
                </h2>

                <Menu.Item>
                  <Disclosure>
                    {({ open }) => (
                      <>
                        <Disclosure.Button
                          className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                        >
                          <Icon
                            name="dolar"
                            className="ml-1 mr-4 text-yellow-300"
                          />

                          <span
                            className="text-base px-3"
                          >
                            Syscoin networks
                          </span>

                          <Icon
                            name="select-up"
                            className={`${open ?
                              'transform rotate-180' :
                              ''
                              } text-yellow-300 mb-1`}
                          />
                        </Disclosure.Button>

                        <Disclosure.Panel
                          className="pt-0.5 pb-2 text-sm bg-brand-navydarker"
                        >
                          {Object.values(SYS_NETWORK).map((network: any) => {
                            return (
                              <li
                                className="mt-2 flex items-center flex-col p-2.5 text-sm font-medium text-white transition transform bg-brand-navydarker backface-visibility-hidden active:bg-opacity-40 hover:scale-105 focus:outline-none justify-around duration-300 mx-auto max-w-95"
                                onClick={() => handleChangeNetwork(network.id)}
                              >
                                <span>{network.label}</span>

                                {activeNetwork === network.id && (
                                  <Icon
                                    name="check"
                                    className="w-4 mb-1"
                                    wrapperClassname="w-6 absolute right-1"
                                  />
                                )}
                              </li>
                            )
                          })}
                        </Disclosure.Panel>
                      </>
                    )}
                  </Disclosure>
                </Menu.Item>

                <Menu.Item>
                  <Disclosure>
                    {({ open }) => (
                      <>
                        <Disclosure.Button
                          className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                        >
                          <Icon
                            name="dolar"
                            className="ml-1 mr-4 text-yellow-300"
                          />

                          <span
                            className="text-base px-3"
                          >
                            Ethereum networks
                          </span>

                          <Icon
                            name="select-up"
                            className={`${open ?
                              'transform rotate-180' :
                              ''
                              } mb-1 text-yellow-300`}
                          />
                        </Disclosure.Button>

                        <Disclosure.Panel
                          className="pt-0.5 pb-2 text-sm bg-brand-navydarker"
                        >
                          {Object.values(SYS_NETWORK).map((network: any) => {
                            return (
                              <li
                                className="mt-2 flex items-center flex-col p-2.5 text-sm font-medium text-white transition transform bg-brand-navydarker backface-visibility-hidden active:bg-opacity-40 hover:scale-105 focus:outline-none justify-around duration-300 mx-auto max-w-95"
                                onClick={() => handleChangeNetwork(network.id)}
                              >
                                <span>{network.label}</span>

                                {activeNetwork === network.id && (
                                  <Icon
                                    name="check"
                                    className="w-4 mb-1"
                                    wrapperClassname="w-6 absolute right-1"
                                  />
                                )}
                              </li>
                            )
                          })}
                        </Disclosure.Panel>
                      </>
                    )}
                  </Disclosure>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => handleChangeNetwork('localhost')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="home" className="ml-1 mr-4 text-yellow-300" />

                    <span className="px-3">Localhost 8545</span>

                    {activeNetwork === 'localhost' && (
                      <Icon
                        name="check"
                        className="w-4 mb-1"
                        wrapperClassname="w-6 absolute right-1"
                      />
                    )}
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/networks-custom-rpc')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="appstoreadd" className="text-yellow-300 ml-1 mr-4" />

                    <span className="px-3">Custom RPC</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/networks-edit')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="edit" className="text-yellow-300 ml-1 mr-4" />

                    <span className="px-3">Edit networks</span>
                  </li>
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }

  const GeneralMenu = () => {
    return (
      <Menu
        as="div"
        className="absolute right-2 inline-block text-right z-10"
      >
        {() => (
          <>
            <Menu.Button
              className="mb-2 mr-0.8"
            >
              {encriptedMnemonic && !importSeed ? (
                <IconButton
                  type="primary"
                  shape="circle"
                >
                  <Icon name="settings" className="text-brand-white z-0" />
                </IconButton>
              ) : (
                null
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
              <div
                className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
              />

              <Menu.Items
                as="div"
                className="menu bg-brand-navyborder pb-6 overflow-auto text-brand-white font-poppins shadow-2xl absolute z-10 right-0 h-96 origin-top-right rounded-2xl ring-1 ring-black ring-opacity-5 focus:outline-none text-center w-72"
              >
                <h2
                  className=" bg-brand-navydarker pt-8 pb-6 text-brand-white border-b border-dashed border-brand-royalBlue w-full text-center mb-6"
                >
                  GENERAL SETTINGS
                </h2>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/general-autolock')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="clock" className="text-brand-royalBlue ml-1 mr-4" />

                    <span className="px-3">Auto lock timer</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/general-currency')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="dolar" className="text-brand-royalBlue ml-1 mr-4" />

                    <span className="px-3">Currency</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/general-phrase')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="wallet" className="text-brand-royalBlue ml-1 mr-4" />

                    <span className="px-3">Wallet Seed Phrase</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/general-about')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="warning" className="text-brand-royalBlue ml-1 mr-4" />

                    <span className="px-3">Info/Help</span>
                  </li>
                </Menu.Item>

                <Menu.Item>
                  <li
                    onClick={() => history.push('/general-delete')}
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                  >
                    <Icon name="delete" className="text-brand-royalBlue ml-1 mr-4" />

                    <span className="px-3">Delete wallet</span>
                  </li>
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }

  return (
    <div className="relative flex items-center justify-between bg-brand-navydarker text-gray-300 p-2 py-6 w-full">
      <NetworkMenu />

      <IconButton
        onClick={handleRefresh}
        className="text-brand-white absolute right-10"
      >
        <Icon
          name="reload"
          wrapperClassname="mb-2 mr-2"
        />
      </IconButton>

      <GeneralMenu />
    </div>
  );
};
