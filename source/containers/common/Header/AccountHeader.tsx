import React, { FC, useEffect } from 'react';
import { IconButton, Icon } from 'components/index';
import {
  useFormat,
  useAccount,
  useStore,
  useUtils,
  useController,
} from 'hooks/index';
import { toSvg } from 'jdenticon';
import { Disclosure, Menu, Transition } from '@headlessui/react';
import { IAccountState } from 'state/wallet/types';

interface IAccountHeader {
  importSeed: boolean;
  isUnlocked: boolean;
}

export const AccountHeader: FC<IAccountHeader> = ({ importSeed }) => {
  const controller = useController();

  const { activeAccount } = useAccount();
  const { ellipsis } = useFormat();
  const { navigate, useCopyClipboard, alert } = useUtils();
  const { encriptedMnemonic, accounts, activeAccountId } = useStore();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');

    if (placeholder) {
      placeholder.innerHTML = toSvg(activeAccount?.xpub, 50, {
        backColor: '#07152B',
        padding: 1,
      });
    }
  }, [activeAccount?.address.main]);

  const switchAccount = (id: number) => {
    controller.wallet.switchWallet(Number(id));
    controller.wallet.account.watchMemPool(accounts[Number(id)]);
  };

  const handleLogout = () => {
    controller.wallet.logOut();

    navigate('/app.html');
  };

  const showSuccessAlert = () => {
    if (copied) {
      alert.removeAll();
      alert.success('Address successfully copied');
    }
  };

  const AccountMenu = () => (
    <Menu
      as="div"
      className="absolute right-3 inline-block text-right md:max-w-2xl"
    >
      <Menu.Button className="inline-flex justify-center w-full  text-sm font-medium text-white hover:text-button-primaryhover rounded-full hover:bg-opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75">
        {encriptedMnemonic && !importSeed && (
          <Icon name="dots" className="z-0" id="account-settings-btn" />
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
        <div className="transition-all duration-300 ease-in-out fixed -inset-0 w-full z-0 bg-brand-black bg-opacity-50" />

        <Menu.Items
          as="div"
          className="scrollbar-styled bg-menu-primary pb-6 overflow-auto text-brand-white font-poppins shadow-2xl absolute z-10 right-0 origin-top-right rounded-2xl ring-1 ring-black ring-opacity-5 focus:outline-none text-center w-72"
        >
          <h2
            className="bg-menu-primary pt-8 pb-6 text-brand-white border-b border-dashed border-dashed-light w-full text-center mb-3"
            id="account-settings-title"
          >
            ACCOUNT SETTINGS
          </h2>

          <Menu.Item>
            <li
              onClick={() => navigate('/account-priv')}
              className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
              id="your-keys-btn"
            >
              <Icon name="key" className="ml-1 mb-2 mr-4 text-brand-white" />

              <span className="px-3">Your keys</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <Disclosure>
              {({ open }) => (
                <>
                  <Disclosure.Button
                    className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
                    id="accounts-btn"
                  >
                    <Icon
                      name="user"
                      className="ml-1 mb-2 mr-4 text-brand-white"
                    />

                    <span className="text-base px-3">Accounts</span>

                    <Icon
                      name="select-down"
                      className={`${
                        open ? 'transform rotate-180' : ''
                      } mb-1 text-brand-white`}
                    />
                  </Disclosure.Button>

                  <Disclosure.Panel className="scrollbar-styled pb-2 text-sm bg-menu-secondary max-h-40 h-auto overflow-auto">
                    <li
                      onClick={() => navigate('/account-newaccount')}
                      className="flex items-center p-2.5 text-sm font-medium text-brand-white transition transform bg-menu-secondary mb-4 backface-visibility-hidden active:bg-opacity-40 focus:outline-none justify-center duration-300 mx-auto w-full border-b border-dashed border-menu-dasheddark cursor-pointer hover:bg-bkg-2"
                      id="create-account-btn"
                    >
                      <Icon
                        name="appstoreadd"
                        className="text-brand-white mb-1 mr-3"
                      />

                      <span>Create new account</span>
                    </li>

                    {accounts.map((account: IAccountState, index) => (
                      <li
                        key={account.id}
                        className="mt-2 flex items-center flex-col p-2.5 text-sm font-medium text-white transition transform bg-menu-secondary backface-visibility-hidden active:bg-opacity-40 hover:scale-105 focus:outline-none justify-around duration-300 mx-auto max-w-95 cursor-pointer"
                        onClick={() => switchAccount(account.id)}
                        id={`account-${index}`}
                      >
                        <span>
                          {account.label} (
                          {ellipsis(account.address.main, 4, 8)})
                        </span>

                        {activeAccountId === account.id && (
                          <Icon
                            name="check"
                            className="w-4 mb-1"
                            wrapperClassname="w-6 absolute right-1"
                          />
                        )}
                      </li>
                    ))}
                  </Disclosure.Panel>
                </>
              )}
            </Disclosure>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={() => navigate('/account-hardware')}
              className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
              id="hardware-wallet-btn"
            >
              <Icon
                name="partition"
                className="text-brand-white ml-1 mr-4 mb-2"
              />

              <span className="px-3">Hardware wallet</span>
            </li>
          </Menu.Item>

          <Menu.Item>
            <li
              onClick={handleLogout}
              className="flex py-3 justify-start items-center w-full text-base px-5 cursor-pointer transition-all duration-200 hover:bg-bkg-3"
              id="lock-btn"
            >
              <Icon name="lock" className="text-brand-white ml-1 mr-4 mb-2" />

              <span className="px-3">Lock</span>
            </li>
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  );

  return (
    <div className="flex items-center justify-between bg-bkg-3 p-1">
      <div className="flex items-center w-full text-brand-white">
        <div className="add-identicon mr-2 ml-1 my-2" />

        <div className="text-brand-white px-1 justify-center items-center">
          <p className="text-base mb-1">{activeAccount?.label}</p>
          <p className="text-xs" id="active-account">
            {ellipsis(activeAccount?.address.main, 6, 14)}
          </p>
        </div>

        <IconButton
          onClick={() => copy(activeAccount?.address.main)}
          type="primary"
          shape="circle"
          className="mt-3"
        >
          <Icon name="copy" className="text-xs" id="copy-address-btn" />
        </IconButton>

        {copied && showSuccessAlert()}
      </div>

      <AccountMenu />
    </div>
  );
};
