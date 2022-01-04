import React, { FC, useEffect } from 'react';
import { IconButton, Icon } from 'components/index';
import { useFormat, useAccount, useStore, useUtils, useController } from 'hooks/index';
import { toSvg } from 'jdenticon';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { IAccountState } from 'state/wallet/types';

interface IAccountHeader {
  importSeed: boolean;
  isUnlocked: boolean;
  showSettings: any;
}

export const AccountHeader: FC<IAccountHeader> = ({
  importSeed,
}) => {
  const controller = useController();

  const { activeAccount } = useAccount();
  const { ellipsis } = useFormat();
  const { history } = useUtils();
  const { encriptedMnemonic, accounts, activeAccountId } = useStore();

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');

    placeholder!.innerHTML = toSvg(activeAccount?.xpub, 50, {
      backColor: '#07152B',
      padding: 1
    });
  }, [activeAccount?.address.main]);

  const switchAccount = (id: number) => {
    controller.wallet.switchWallet(Number(id));
    controller.wallet.account.watchMemPool(accounts[Number(id)]);
  }

  const handleLogout = () => {
    controller.wallet.logOut();

    history.push('/app.html');
  };

  const AccountMenu = () => {
    return (
      <Menu
        as="div"
        className="absolute right-2 inline-block text-right"
      >
        <Menu.Button
          className="inline-flex justify-center w-full  text-sm font-medium text-white rounded-full hover:bg-opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
        >
          {encriptedMnemonic && !importSeed && <Icon name="dots" className="text-brand-white z-0" />}
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
            className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-black bg-opacity-50"
          />

          <Menu.Items
            as="div"
            className="scrollbar-styled bg-menu-primary pb-6 overflow-auto text-brand-white font-poppins shadow-2xl absolute z-10 right-0 origin-top-right rounded-2xl ring-1 ring-black ring-opacity-5 focus:outline-none text-center w-72"
          >
            <h2
              className="bg-menu-primary pt-8 pb-6 text-brand-white border-b border-dashed border-dashed-light w-full text-center mb-3"
            >
              ACCOUNT SETTINGS
            </h2>

            <Menu.Item>
              <li
                onClick={() => history.push('/account-priv')}
                className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
              >
                <Icon name="edit" className="ml-1 mr-4 text-brand-white" />

                <span className="px-3">XPUB</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <Disclosure>
                {({ open }) => (
                  <>
                    <Disclosure.Button
                      className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
                    >
                      <Icon
                        name="user"
                        className="ml-1 mr-4 text-brand-white"
                      />

                      <span
                        className="text-base px-3"
                      >
                        Accounts
                      </span>

                      <Icon
                        name="select-up"
                        className={`${open ?
                          'transform rotate-180' :
                          ''
                          } mb-1 text-brand-white`}
                      />
                    </Disclosure.Button>

                    <Disclosure.Panel
                      className="scrollbar-styled pb-2 text-sm bg-menu-secondary h-40 overflow-auto"
                    >
                      <li
                        onClick={() => history.push('/account-newaccount')}
                        className="flex items-center p-2.5 text-sm font-medium text-brand-white transition transform bg-menu-secondary mb-4 backface-visibility-hidden active:bg-opacity-40 focus:outline-none justify-center duration-300 mx-auto w-full border-b border-dashed border-menu-dasheddark cursor-pointer hover:bg-bkg-2"
                      >
                        <Icon name="appstoreadd" className="text-brand-white mb-1" />

                        <span>Create new account</span>
                      </li>

                      {accounts.map((account: IAccountState) => {
                        return (
                          <li
                            className="mt-2 flex items-center flex-col p-2.5 text-sm font-medium text-white transition transform bg-menu-secondary backface-visibility-hidden active:bg-opacity-40 hover:scale-105 focus:outline-none justify-around duration-300 mx-auto max-w-95 cursor-pointer"
                            onClick={() => switchAccount(account.id)}
                          >
                            <span>{account.label} ({ellipsis(account.address.main, 4, 8)})</span>

                            {activeAccountId === account.id && (
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
                onClick={() => history.push('/account-hardware')}
                className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
              >
                <Icon name="partition" className="text-brand-white ml-1 mr-4" />

                <span className="px-3">Hardware wallet</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={handleLogout}
                className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
              >
                <Icon name="key" className="text-brand-white ml-1 mr-4" />

                <span className="px-3">Lock</span>
              </li>
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    )
  }

  return (
    <div className="flex items-center justify-between bg-bkg-3 p-1">
      <div className="flex items-center w-full text-brand-white">
        <div className="add-identicon mr-2 ml-1 my-2"></div>

        <div className="text-brand-white px-1 justify-center items-center">
          <p className="text-base mb-1">{activeAccount!.label}</p>
          <p className="text-xs">{ellipsis(activeAccount!.address.main, 6, 14)}</p>
        </div>

        <IconButton
          type="primary"
          shape="circle"
          className="mt-3"
        >
          <Icon name="copy" className="text-xs" />
        </IconButton>
      </div>

      <AccountMenu />
    </div>
  )
}
