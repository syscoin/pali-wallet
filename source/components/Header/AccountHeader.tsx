import { Disclosure, Menu, Transition } from '@headlessui/react';
import { toSvg } from 'jdenticon';
import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';

import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

const AccountMenu: React.FC = () => {
  const { navigate } = useUtils();
  const { wallet } = getController();
  const {
    vault: { accounts, activeAccount, encryptedMnemonic },
  } = useSelector((state: RootState) => state);

  const numberOfAccounts = Object.keys(accounts).length;

  let className: string;
  switch (numberOfAccounts) {
    case 1:
      className = 'h-16';
      break;
    case 2:
      className = 'h-28';
      break;
    default:
      className = 'h-40';
      break;
  }

  const setActiveAccount = async (id: number) => {
    await wallet.setAccount(Number(id));
    wallet.account.sys.watchMemPool();
  };

  const handleLogout = () => {
    wallet.lock();

    navigate('/');
  };

  return (
    <Menu
      id="account-settings-btn"
      as="div"
      className="absolute right-3 inline-block text-right md:max-w-2xl"
    >
      <Menu.Button className="inline-flex justify-center w-full hover:text-button-primaryhover text-white text-sm font-medium hover:bg-opacity-30 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
        {encryptedMnemonic && <Icon name="dots" className="z-0" />}
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
        <div className="fixed z-0 -inset-0 w-full bg-brand-black bg-opacity-50 transition-all duration-300 ease-in-out" />

        <Menu.Items
          as="div"
          className="scrollbar-styled absolute z-10 right-0 top-0 w-72 text-center text-brand-white font-poppins bg-menu-primary rounded-2xl focus:outline-none shadow-2xl overflow-auto origin-top-right ring-1 ring-black ring-opacity-5"
        >
          <h2
            className="mb-3 pb-6 pt-8 w-full text-center text-brand-white bg-menu-primary border-b border-dashed border-dashed-light"
            id="account-settings-title"
          >
            ACCOUNT SETTINGS
          </h2>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/account/private-key')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon name="key" className="mb-2 ml-1 mr-2 text-brand-white" />

              <span className="px-3">Your keys</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <Disclosure>
              {({ open }) => (
                <>
                  <Disclosure.Button className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200">
                    <Icon
                      name="user"
                      className="mb-2 ml-1 mr-2 text-brand-white"
                      id="accounts-btn"
                    />

                    <span className="px-3 text-base">Accounts</span>

                    <Icon
                      name="select-down"
                      className={`${
                        open ? 'transform rotate-180' : ''
                      } mb-1 text-brand-white`}
                    />
                  </Disclosure.Button>

                  <div
                    className="relative"
                    style={{
                      paddingTop: `${open ? '45px' : '0px'}`,
                    }}
                  >
                    <Disclosure.Panel
                      className={`static overflow-y-scroll scrollbar-styled pb-2 ${className} text-sm bg-menu-secondary`}
                    >
                      <li
                        onClick={() => navigate('/settings/account/new')}
                        className="backface-visibility-hidden absolute top-0 flex items-center justify-center mb-4 mx-auto p-2.5 w-full text-brand-white text-sm font-medium hover:bg-bkg-2 bg-menu-secondary active:bg-opacity-40 border-b border-dashed border-gray-500 focus:outline-none cursor-pointer transform transition duration-300"
                        id="create-new-account-btn"
                      >
                        <Icon
                          name="appstoreadd"
                          className="mb-1 mr-3 text-brand-white"
                        />

                        <span>Create new account</span>
                      </li>

                      {Object.values(accounts).map((account, index) => (
                        <li
                          key={account.id}
                          className="backface-visibility-hidden flex flex-col items-center justify-around mt-2 mx-auto p-2.5 max-w-95 text-white text-sm font-medium bg-menu-secondary active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-105 transition duration-300"
                          onClick={() => setActiveAccount(account.id)}
                          id={`account-${index}`}
                        >
                          <span>
                            {account.label} ({ellipsis(account.address, 4, 8)})
                          </span>

                          {activeAccount.id === account.id && (
                            <Icon
                              name="check"
                              className="mb-1 w-4"
                              wrapperClassname="w-6 absolute right-1"
                            />
                          )}
                        </li>
                      ))}
                    </Disclosure.Panel>
                  </div>
                </>
              )}
            </Disclosure>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/settings/account/hardware')}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon
                name="partition"
                className="mb-2 ml-1 mr-2 text-brand-white"
                id="hardware-wallet-btn"
              />

              <span className="px-3">Hardware wallet</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={handleLogout}
              className="flex items-center justify-start px-5 py-3 w-full text-base hover:bg-bkg-3 cursor-pointer transition-all duration-200"
            >
              <Icon name="lock" className="mb-2 ml-1 mr-2 text-brand-white" />

              <span className="px-3">Lock</span>
            </li>
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );
};

export const AccountHeader: React.FC = () => {
  const {
    vault: { activeAccount },
  } = useSelector((state: RootState) => state);

  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(activeAccount?.xpub, 50, {
      backColor: '#07152B',
      padding: 1,
    });
  }, [activeAccount?.address]);

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Address successfully copied');
  }, [copied]);

  return (
    <div className="flex items-center justify-between p-1 bg-bkg-3">
      <div className="flex items-center w-full text-brand-white">
        <div className="add-identicon ml-1 mr-2 my-2" />

        <div className="items-center justify-center px-1 text-brand-white">
          <p className="mb-1 text-base" id="active-account-label">
            {activeAccount?.label}
          </p>
          <p className="text-xs">{ellipsis(activeAccount?.address, 6, 14)}</p>
        </div>

        <IconButton
          onClick={() => copy(activeAccount?.address ?? '')}
          type="primary"
          shape="circle"
          className="mt-3"
        >
          <Icon name="copy" className="text-xs" id="copy-address-btn" />
        </IconButton>
      </div>

      <AccountMenu />
    </div>
  );
};
