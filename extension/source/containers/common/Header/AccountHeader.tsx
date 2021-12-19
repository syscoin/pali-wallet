import React, { FC, useEffect } from 'react';
import { IconButton, Icon } from 'components/index';
import { useFormat, useAccount, useStore, useUtils, useController } from 'hooks/index';
import { toSvg } from 'jdenticon';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { IAccountState } from 'state/wallet/types';

interface IAccountHeader {
  importSeed: boolean;
  isUnlocked: boolean;
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

    placeholder!.innerHTML = toSvg(activeAccount?.address.main, 50, {
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
            className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-darktransparent"
          />

          <Menu.Items
            as="div"
            className="menu bg-brand-navyborder pb-6 overflow-auto text-brand-white font-poppins shadow-2xl absolute z-10 right-0 h-85 origin-top-right rounded-2xl ring-1 ring-black ring-opacity-5 focus:outline-none text-center w-72"
          >
            <h2
              className="bg-brand-navydarker pt-8 pb-6 text-brand-white border-b border-dashed border-brand-deepPink100 w-full text-center mb-6"
            >
              ACCOUNT SETTINGS
            </h2>

            <Menu.Item>
              <li
                onClick={() => history.push('/account-priv')}
                className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
              >
                <Icon name="edit" className="ml-1 mr-4 text-brand-deepPink100" />

                <span className="px-3">XPUB</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <Disclosure>
                {({ open }) => (
                  <>
                    <Disclosure.Button
                      className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
                    >
                      <Icon
                        name="user"
                        className="ml-1 mr-4 text-brand-deepPink100"
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
                          } mb-1 text-brand-deepPink100`}
                      />
                    </Disclosure.Button>

                    <Disclosure.Panel
                      className="pt-0.5 pb-2 text-sm bg-brand-navydarker h-32 overflow-auto"
                    >
                      <li
                        onClick={() => history.push('/account-newaccount')}
                        className="flex w-full items-center p-2.5 text-sm font-medium text-brand-deepPink100 transition transform bg-brand-navydarker mb-4 backface-visibility-hidden active:bg-opacity-40 hover:scale-105 focus:outline-none justify-center duration-300 mx-auto max-w-95 border-b border-dashed border-brand-deepPink100 cursor-pointer"
                      >
                        <Icon name="appstoreadd" className="text-brand-white mb-1" />

                        <span>Create new account</span>
                      </li>

                      {accounts.map((account: IAccountState) => {
                        return (
                          <li
                            className="mt-2 flex items-center flex-col p-2.5 text-sm font-medium text-white transition transform bg-brand-navydarker backface-visibility-hidden active:bg-opacity-40 hover:scale-105 focus:outline-none justify-around duration-300 mx-auto max-w-95 cursor-pointer"
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
                className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
              >
                <Icon name="partition" className="text-brand-deepPink100 ml-1 mr-4" />

                <span className="px-3">Hardware wallet</span>
              </li>
            </Menu.Item>

            <Menu.Item>
              <li
                onClick={handleLogout}
                className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:text-brand-graylight"
              >
                <Icon name="key" className="text-brand-deepPink100 ml-1 mr-4" />

                <span className="px-3">Lock</span>
              </li>
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    )
  }

  return (
    <div className="flex items-center justify-between bg-brand-navyborder p-1">
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
