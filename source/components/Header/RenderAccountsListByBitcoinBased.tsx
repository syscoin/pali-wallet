import { Menu } from '@headlessui/react';
import React from 'react';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import importIcon from 'assets/images/import.png';
import ledgerLogo from 'assets/images/ledgerLogo.png';
import trezorLogo from 'assets/images/trezorLogo.png';
import logo from 'assets/images/whiteLogo.png';
import { Icon } from 'components/index';
import { RootState } from 'state/store';
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
    <Menu.Item>
      {({ close }) => (
        <>
          {isBitcoinBased ? (
            <>
              {Object.values(accounts.HDAccount)
                .filter((acc) => acc.isImported === false)
                .map((account, index) => (
                  <li
                    className={`py-1.5 px-5 w-max backface-visibility-hidden flex items-center text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none cursor-pointer transform
                   transition duration-300`}
                    onClick={async () => {
                      await setActiveAccount(
                        account.id,
                        KeyringAccountType.HDAccount
                      );
                      close();
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    <span
                      style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
                      className="w-max gap-[2px] flex items-center justify-start whitespace-nowrap overflow-hidden"
                    >
                      <img src={logo} className="mr-1 w-7" alt="" />
                      {account.label} ({ellipsis(account.address, 4, 4)})
                    </span>
                    <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                      Pali
                    </span>
                    {activeAccount.id === account.id &&
                      activeAccount.type === KeyringAccountType.HDAccount && (
                        <Icon
                          name="check"
                          className="mb-1 ml-2 w-4"
                          color="#8EC100"
                        />
                      )}
                  </li>
                ))}

              {Object.values(accounts.Imported)
                .filter((acc) => !acc.address.startsWith('0x'))
                .map((account, index) => (
                  <li
                    className={`py-1.5 px-5 w-max backface-visibility-hidden flex items-center text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none cursor-pointer transform
                   transition duration-300`}
                    onClick={async () => {
                      await setActiveAccount(
                        account.id,
                        KeyringAccountType.Imported
                      );
                      close();
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    <span
                      style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
                      className="w-max gap-[2px] flex items-center justify-start whitespace-nowrap overflow-hidden"
                    >
                      <img src={logo} className="mr-1 w-7" alt="" />
                      {account.label} ({ellipsis(account.address, 4, 4)})
                    </span>
                    <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                      Imported
                    </span>
                    {activeAccount.id === account.id &&
                      activeAccount.type === KeyringAccountType.Imported && (
                        <Icon
                          name="check"
                          className="mb-1 ml-2 w-4"
                          color="#8EC100"
                        />
                      )}
                  </li>
                ))}

              {Object.values(accounts.Trezor)
                .filter((acc) => acc.isImported === false)
                .map((account, index) => (
                  <li
                    className={`py-1.5 px-5 w-max  backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'hidden'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                    onClick={async () => {
                      if (account?.originNetwork.url !== activeNetwork.url) {
                        return;
                      }
                      await setActiveAccount(
                        account.id,
                        KeyringAccountType.Trezor
                      );
                      close();
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
                        alt=""
                        style={{
                          filter:
                            'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                        }}
                        className="mr-1 w-7"
                      />
                      {account.label}{' '}
                      {!(account?.originNetwork.url !== activeNetwork.url) &&
                        `(${ellipsis(account.address, 4, 4)})`}
                    </span>

                    <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                      Trezor
                    </span>

                    {activeAccount.id === account.id &&
                      activeAccount.type === KeyringAccountType.Trezor && (
                        <Icon
                          name="check"
                          className="mb-1 ml-2 w-4"
                          color="#8EC100"
                        />
                      )}
                  </li>
                ))}

              {Object.values(accounts.Ledger)
                .filter((acc) => acc.isImported === false)
                .map((account, index) => (
                  <li
                    className={`py-1.5 px-5 w-max  backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'hidden'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                    onClick={async () => {
                      if (account?.originNetwork.url !== activeNetwork.url) {
                        return;
                      }
                      await setActiveAccount(
                        account.id,
                        KeyringAccountType.Ledger
                      );
                      close();
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
                        src={ledgerLogo}
                        alt=""
                        style={{
                          filter:
                            'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                        }}
                        className="mr-2 w-7"
                      />
                      {account.label}{' '}
                      {!(account?.originNetwork.url !== activeNetwork.url) &&
                        `(${ellipsis(account.address, 4, 4)})`}
                    </span>

                    <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                      Ledger
                    </span>

                    {activeAccount.id === account.id &&
                      activeAccount.type === KeyringAccountType.Ledger && (
                        <Icon
                          name="check"
                          className="mb-1 ml-2 w-4"
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
                    .filter((account) => account.address.startsWith('0x'))
                    .map((account, index) => (
                      <li
                        className={`py-1.5 px-5 w-max backface-visibility-hidden flex items-center justify-start text-white text-sm 
                  font-medium active:bg-opacity-40 focus:outline-none ${
                    (account.isTrezorWallet &&
                      account?.originNetwork?.isBitcoinBased) ||
                    (account.isLedgerWallet &&
                      account?.originNetwork?.isBitcoinBased)
                      ? 'hidden'
                      : 'cursor-pointer'
                  } transform
                   transition duration-300`}
                        onClick={async () => {
                          if (
                            (account.isTrezorWallet &&
                              account?.originNetwork?.isBitcoinBased) ||
                            (account.isLedgerWallet &&
                              account?.originNetwork?.isBitcoinBased)
                          ) {
                            return;
                          }
                          await setActiveAccount(
                            account.id,
                            keyringAccountType as KeyringAccountType
                          );
                          close();
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
                            <img src={importIcon} className="mr-1 w-7" alt="" />
                          ) : account.isTrezorWallet ? (
                            <img
                              src={trezorLogo}
                              alt=""
                              style={{
                                filter:
                                  'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                              }}
                              className="mr-1 w-7"
                            />
                          ) : account.isLedgerWallet ? (
                            <img
                              src={ledgerLogo}
                              alt=""
                              style={{
                                filter:
                                  'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                              }}
                              className="mr-1 w-7"
                            />
                          ) : (
                            <img src={logo} className="mr-1 w-7" alt="" />
                          )}{' '}
                          {account.label}{' '}
                          {!(
                            (account.isTrezorWallet &&
                              account?.originNetwork?.isBitcoinBased) ||
                            (account.isLedgerWallet &&
                              account?.originNetwork?.isBitcoinBased)
                          ) && `(${ellipsis(account.address, 4, 4)})`}
                        </span>

                        {activeAccount.id === account.id &&
                          activeAccount.type === keyringAccountType && (
                            <Icon
                              name="check"
                              className="mb-1 ml-2 w-4"
                              wrapperClassname="relative right-0.5"
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
      )}
    </Menu.Item>
  );
};

export default RenderAccountsListByBitcoinBased;
