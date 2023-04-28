import { Disclosure, Menu, Transition } from '@headlessui/react';
import { toSvg } from 'jdenticon';
import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import importIcon from 'assets/images/import.png';
import trezorLogo from 'assets/images/trezorLogo.png';
import logo from 'assets/images/whiteLogo.png';
import { IconButton, Icon, Tooltip } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

type RenderAccountsListByBitcoinBasedProps = {
  setActiveAccount: (id: number, type: KeyringAccountType) => Promise<void>;
};

const RenderAccountsListByBitcoinBased = (
  props: RenderAccountsListByBitcoinBasedProps
) => {
  const { setActiveAccount } = props;

  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { activeNetwork } = useSelector((state: RootState) => state.vault);

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  return (
    <>
      {isBitcoinBased ? ( // If the network is Bitcoinbased only show SYS UTX0 accounts -> isImported === false
        <>
          {Object.values(accounts.HDAccount)
            .filter((acc) => acc.isImported === false) //todo we don't have account.isImported anymore
            .map((account, index, { length }) => (
              <Tooltip
                key={account.id}
                childrenClassName={`${index === 0 && 'mt-1'} flex w-full`}
                placement="top-end"
                content={account.address}
              >
                <li
                  className={`${
                    index + 1 !== length &&
                    'border-b border-dashed border-gray-500'
                  } ${
                    index === 0 ? 'py-3.5' : 'py-4'
                  } w-full  backface-visibility-hidden flex items-center justify-center text-white text-sm 
                  font-medium bg-menu-secondary hover:bg-bkg-2 active:bg-opacity-40 focus:outline-none cursor-pointer transform hover:scale-103
                   transition duration-300`}
                  onClick={() =>
                    setActiveAccount(account.id, KeyringAccountType.HDAccount)
                  }
                  id={`account-${index}`}
                >
                  <span
                    style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
                    className="w-fit flex items-center justify-center whitespace-nowrap overflow-hidden"
                  >
                    <img src={logo} className="mr-1 w-7"></img>
                    {account.label} ({ellipsis(account.address, 4, 8)})
                  </span>

                  {activeAccount.id === account.id &&
                    activeAccount.type === KeyringAccountType.HDAccount && (
                      <Icon
                        name="check"
                        className="mb-1 w-4"
                        wrapperClassname="absolute right-2.5"
                      />
                    )}
                </li>
              </Tooltip>
            ))}

          {Object.values(accounts.Trezor)
            .filter((acc) => acc.isImported === false) //todo we don't have account.isImported anymore
            .map((account, index, { length }) => (
              <Tooltip
                key={account.id}
                childrenClassName={`${index === 0 && 'mt-1'} flex w-full`}
                placement="top-end"
                content={account.address}
              >
                <li
                  className={`${
                    index + 1 !== length &&
                    'border-b border-dashed border-gray-500'
                  } ${
                    index === 0 ? 'py-3.5' : 'py-4'
                  } w-full  backface-visibility-hidden flex items-center justify-center text-white text-sm 
                  font-medium bg-menu-secondary hover:bg-bkg-2 active:bg-opacity-40 focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'cursor-not-allowed disabled'
                      : 'cursor-pointer'
                  } transform hover:scale-103
                   transition duration-300`}
                  onClick={() => {
                    if (account?.originNetwork.url !== activeNetwork.url) {
                      return;
                    }
                    setActiveAccount(account.id, KeyringAccountType.Trezor);
                  }}
                  id={`account-${index}`}
                >
                  <span
                    style={{
                      maxWidth: '16.25rem',
                      textOverflow: 'ellipsis',
                    }}
                    className="w-fit flex items-center justify-center whitespace-nowrap overflow-hidden"
                  >
                    <img
                      src={trezorLogo}
                      style={{
                        filter:
                          'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                      }}
                      className="mr-1 w-7"
                    ></img>
                    {account.label}{' '}
                    {!(account?.originNetwork.url !== activeNetwork.url) &&
                      `(${ellipsis(account.address, 4, 8)})`}
                  </span>

                  {activeAccount.id === account.id &&
                    activeAccount.type === KeyringAccountType.Trezor && (
                      <Icon
                        name="check"
                        className="mb-1 w-4"
                        wrapperClassname="absolute right-2.5"
                      />
                    )}
                </li>
              </Tooltip>
            ))}
        </>
      ) : (
        Object.entries(accounts).map(
          ([keyringAccountType, accountTypeAccounts]) => (
            <div key={keyringAccountType}>
              {Object.values(accountTypeAccounts)
                .filter((account) => account.xpub !== '')
                .map((account, index, { length }) => (
                  <Tooltip
                    key={account.id}
                    childrenClassName={`${index === 0 && 'mt-1'} flex w-full`}
                    placement="top-end"
                    content={
                      account.isImported
                        ? `${account.address} [imported]`
                        : account.isTrezorWallet
                        ? `${account.address} [trezor account]`
                        : `${account.address} [pali account]`
                    }
                  >
                    <li
                      className={`${
                        index + 1 !== length &&
                        'border-b border-dashed border-gray-500'
                      } ${
                        index === 0 ? 'py-3.5' : 'py-4'
                      } w-full backface-visibility-hidden flex items-center justify-center text-white text-sm 
                  font-medium bg-menu-secondary hover:bg-bkg-2 active:bg-opacity-40 focus:outline-none ${
                    account.isTrezorWallet &&
                    !account?.originNetwork?.isBitcoinBased
                      ? 'cursor-not-allowed disabled'
                      : 'cursor-pointer'
                  } transform hover:scale-103
                   transition duration-300`}
                      onClick={() => {
                        if (
                          account.isTrezorWallet &&
                          !account?.originNetwork?.isBitcoinBased
                        ) {
                          return;
                        }
                        setActiveAccount(
                          account.id,
                          keyringAccountType as KeyringAccountType
                        );
                      }}
                      id={`account-${index}`}
                    >
                      <span
                        style={{
                          maxWidth: '16.25rem',
                          textOverflow: 'ellipsis',
                        }}
                        className="w-fit flex items-center justify-center whitespace-nowrap overflow-hidden"
                      >
                        {account.isImported ? (
                          <img src={importIcon} className="mr-1 w-7"></img>
                        ) : account.isTrezorWallet ? (
                          <img
                            src={trezorLogo}
                            style={{
                              filter:
                                'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                            }}
                            className="mr-1 w-7"
                          ></img>
                        ) : (
                          <img src={logo} className="mr-1 w-7"></img>
                        )}{' '}
                        {account.label}{' '}
                        {!(
                          account.isTrezorWallet &&
                          !account?.originNetwork?.isBitcoinBased
                        ) && `(${ellipsis(account.address, 4, 8)})`}
                      </span>

                      {activeAccount.id === account.id &&
                        activeAccount.type === keyringAccountType && (
                          <Icon
                            name="check"
                            className="mb-1 w-4"
                            wrapperClassname="absolute right-2.5"
                          />
                        )}
                    </li>
                  </Tooltip>
                ))}
            </div>
          )
        )
      )}
    </>
  );
};

const AccountMenu: React.FC = () => {
  const { navigate } = useUtils();
  const { wallet, dapp } = getController();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const isTestnet = wallet.verifyIfIsTestnet();
  const importedAccounts = Object.values(accounts.Imported);
  const hdAccounts = Object.values(accounts.HDAccount);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  //Validate number of accounts to display correctly in UI based in isImported parameter ( Importeds by private key )
  const numberOfAccounts = isBitcoinBased
    ? Object.values(hdAccounts).filter((acc) => acc.isImported === false).length
    : Object.keys(hdAccounts).length + Object.keys(importedAccounts).length;

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

  const setActiveAccount = async (id: number, type: KeyringAccountType) => {
    if (!isBitcoinBased) {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      const host = new URL(tabs[0].url).hostname;
      const connectedAccount = dapp.getAccount(host);
      wallet.setAccount(Number(id), type, host, connectedAccount);
      return;
    }
    wallet.setAccount(Number(id), type);
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
        <Icon name="dots" className="z-0" />
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
                      paddingTop: `${
                        open ? `${isBitcoinBased ? '45px' : '94px'}` : '0px'
                      }`,
                    }}
                  >
                    <Disclosure.Panel
                      className={`static overflow-y-scroll overflow-x-hidden scrollbar-styled pb-2 ${className} text-sm bg-menu-secondary`}
                    >
                      <li
                        onClick={() => navigate('/settings/account/new')}
                        className="backface-visibility-hidden absolute top-0.5 flex items-center justify-center mx-auto p-2.5 w-full text-brand-white text-sm font-medium hover:bg-bkg-2 bg-menu-secondary active:bg-opacity-40 border-b border-solid border-gray-500 focus:outline-none cursor-pointer transform transition duration-300"
                        id="create-new-account-btn"
                      >
                        <Icon
                          name="appstoreadd"
                          className="mb-1 mr-3 text-brand-white"
                        />

                        <span>Create new account</span>
                      </li>

                      {!isBitcoinBased ? (
                        <li
                          onClick={() => navigate('/settings/account/import')}
                          className="backface-visibility-hidden absolute top-12 flex items-center justify-center mx-auto p-2.5 w-full text-brand-white text-sm font-medium hover:bg-bkg-2 bg-menu-secondary active:bg-opacity-40 border-b border-solid border-gray-500 focus:outline-none cursor-pointer transform transition duration-300"
                          id="create-new-account-btn"
                        >
                          <Icon
                            name="import"
                            className="mb-1 mr-3 text-brand-white"
                          />

                          <span>Import new account</span>
                        </li>
                      ) : null}

                      <RenderAccountsListByBitcoinBased
                        setActiveAccount={setActiveAccount}
                      />
                    </Disclosure.Panel>
                  </div>
                </>
              )}
            </Disclosure>
          </Menu.Item>

          {
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
          }

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
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts } = useSelector((state: RootState) => state.vault);
  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(
      accounts[activeAccount.type][activeAccount.id]?.xpub,
      50,
      {
        backColor: '#07152B',
        padding: 1,
      }
    );
  }, [accounts[activeAccount.type][activeAccount.id]?.address]);

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
            {accounts[activeAccount.type][activeAccount.id]?.label}
          </p>
          <p className="text-xs">
            {ellipsis(
              accounts[activeAccount.type][activeAccount.id]?.address,
              6,
              14
            )}
          </p>
        </div>

        <IconButton
          onClick={() =>
            copy(accounts[activeAccount.type][activeAccount.id]?.address ?? '')
          }
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
