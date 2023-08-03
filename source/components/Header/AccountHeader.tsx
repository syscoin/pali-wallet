import { Menu } from '@headlessui/react';
import { toSvg } from 'jdenticon';
import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { browser } from 'webextension-polyfill-ts';

import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';

import importIcon from 'assets/images/import.png';
import trezorLogo from 'assets/images/trezorLogo.png';
import logo from 'assets/images/whiteLogo.png';
import { IconButton, Icon } from 'components/index';
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
            .map((account, index) => (
              <li
                className={`py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-center text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none cursor-pointer transform
                   transition duration-300`}
                onClick={() =>
                  setActiveAccount(account.id, KeyringAccountType.HDAccount)
                }
                id={`account-${index}`}
                key={account.id}
              >
                <span
                  style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
                  className="w-full flex items-center justify-start whitespace-nowrap overflow-hidden"
                >
                  <img src={logo} className="mr-1 w-7"></img>
                  {account.label} ({ellipsis(account.address, 4, 4)})
                </span>

                {activeAccount.id === account.id &&
                  activeAccount.type === KeyringAccountType.HDAccount && (
                    <Icon
                      name="check"
                      className="mb-1 w-4"
                      wrapperClassname="absolute right-2.5"
                      color="#8EC100"
                    />
                  )}
              </li>
            ))}

          {Object.values(accounts.Trezor)
            .filter((acc) => acc.isImported === false) //todo we don't have account.isImported anymore
            .map((account, index) => (
              <li
                className={`py-1.5 px-5 w-full  backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'cursor-not-allowed disabled'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                onClick={() => {
                  if (account?.originNetwork.url !== activeNetwork.url) {
                    return;
                  }
                  setActiveAccount(account.id, KeyringAccountType.Trezor);
                }}
                id={`account-${index}`}
                key={account.id}
              >
                <span
                  style={{
                    maxWidth: '16.25rem',
                    textOverflow: 'ellipsis',
                  }}
                  className="w-full flex items-center justify-start whitespace-nowrap overflow-hidden"
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
                    `(${ellipsis(account.address, 4, 4)})`}
                </span>

                {activeAccount.id === account.id &&
                  activeAccount.type === KeyringAccountType.Trezor && (
                    <Icon
                      name="check"
                      className="mb-1 w-4"
                      wrapperClassname="absolute right-2.5"
                      color="#8EC100"
                    />
                  )}
              </li>
            ))}
        </>
      ) : (
        Object.entries(accounts).map(
          ([keyringAccountType, accountTypeAccounts]) => (
            <div key={keyringAccountType}>
              {Object.values(accountTypeAccounts)
                .filter((account) => account.xpub !== '')
                .map((account, index) => (
                  <li
                    className={`py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    account.isTrezorWallet &&
                    account?.originNetwork?.isBitcoinBased
                      ? 'cursor-not-allowed disabled'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                    onClick={() => {
                      if (
                        account.isTrezorWallet &&
                        account?.originNetwork?.isBitcoinBased
                      ) {
                        return;
                      }
                      setActiveAccount(
                        account.id,
                        keyringAccountType as KeyringAccountType
                      );
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    <span
                      style={{
                        maxWidth: '16.25rem',
                        textOverflow: 'ellipsis',
                      }}
                      className="w-full flex items-center justify-start whitespace-nowrap overflow-hidden"
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
                        account?.originNetwork?.isBitcoinBased
                      ) && `(${ellipsis(account.address, 4, 4)})`}
                    </span>

                    {activeAccount.id === account.id &&
                      activeAccount.type === keyringAccountType && (
                        <Icon
                          name="check"
                          className="mb-1 w-4"
                          wrapperClassname="absolute right-2.5"
                          color="#8EC100"
                        />
                      )}
                  </li>
                ))}
            </div>
          )
        )
      )}
    </>
  );
};

export const AccountMenu: React.FC = () => {
  const { navigate } = useUtils();
  const { wallet, dapp } = getController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

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

  const cursorType = isBitcoinBased ? 'cursor-not-allowed' : 'cursor-pointer';

  return (
    <>
      <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
        ACCOUNTS
      </span>

      <Menu.Item>
        <>
          <RenderAccountsListByBitcoinBased
            setActiveAccount={setActiveAccount}
          />
        </>
      </Menu.Item>

      <span className="disabled text-xs flex justify-start px-5 my-3">
        ACCOUNTS SETTINGS
      </span>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/account/new')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="appstoreadd" className="mb-1 text-brand-white" />

          <span>Create new account</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/manage-accounts')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="edit" className="mb-2 text-brand-white" />

          <span>Manage accounts</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/account/private-key')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon name="key" className="mb-2 text-brand-white" />

          <span>Your keys</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <li
          onClick={() => navigate('/settings/account/hardware')}
          className="py-1.5 cursor-pointer px-6 w-full backface-visibility-hidden flex items-center gap-3 justify-start text-white text-sm font-medium active:bg-opacity-40 focus:outline-none"
        >
          <Icon
            name="partition"
            className="mb-2 text-brand-white"
            id="hardware-wallet-btn"
          />

          <span>Connect Trezor</span>
        </li>
      </Menu.Item>

      <Menu.Item>
        <div className="flex flex-col gap-2">
          <li
            onClick={() => {
              isBitcoinBased ? null : navigate('/settings/account/import');
            }}
            className={`py-1.5 ${cursorType} px-6 w-full backface-visibility-hidden flex items-center justify-start gap-3 text-white text-sm font-medium active:bg-opacity-40 focus:outline-none`}
          >
            <Icon
              name="import"
              className="mb-1 text-brand-white"
              opacity={isBitcoinBased ? 0.6 : 1}
            />

            <span className={isBitcoinBased ? 'disabled' : ''}>
              Import account
            </span>
          </li>
          {isBitcoinBased && (
            <span className="disabled text-xs px-5 text-left">
              Pali is the only extension wallet with UTXO! To import any wallet,
              you need to change to one EVM network.
            </span>
          )}
        </div>
      </Menu.Item>
    </>
  );
};

export const AccountHeader: React.FC = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { accounts } = useSelector((state: RootState) => state.vault);
  const { useCopyClipboard, alert, navigate } = useUtils();

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

  const editAccount = (account: IKeyringAccountState) => {
    navigate('/settings/edit-account', {
      state: account,
    });
  };

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
          <p className="mb-1 text-base" id="active-account-label items-center">
            {accounts[activeAccount.type][activeAccount.id]?.label}

            <IconButton
              onClick={() =>
                editAccount(accounts[activeAccount.type][activeAccount.id])
              }
              type="primary"
              shape="circle"
            >
              <Icon
                name="edit"
                className="hover:text-brand-royalblue text-xs ml-1 flex justify-center w-4 h-4"
              />
            </IconButton>
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
    </div>
  );
};
