import { Menu } from '@headlessui/react';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import importIcon from 'assets/images/import.png';
import ledgerLogo from 'assets/images/ledgerLogo.png';
import trezorLogo from 'assets/images/trezorLogo.png';
import { PaliWhiteSmallIconSvg, LoadingSvg } from 'components/Icon/Icon';
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
  const [switchingAccount, setSwitchingAccount] = useState<{
    id: number;
    type: KeyringAccountType;
  } | null>(null);

  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { activeNetwork } = useSelector((state: RootState) => state.vault);

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const handleAccountSwitch = async (
    id: number,
    type: KeyringAccountType,
    close: () => void
  ) => {
    setSwitchingAccount({ id, type });
    try {
      await setActiveAccount(id, type);
      close();
    } finally {
      setSwitchingAccount(null);
    }
  };

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
                    className={`group relative py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                  font-medium hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none cursor-pointer transform
                   transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 ${
                     switchingAccount ? 'pointer-events-none opacity-60' : ''
                   }`}
                    onClick={() => {
                      if (switchingAccount) return;
                      handleAccountSwitch(
                        account.id,
                        KeyringAccountType.HDAccount,
                        close
                      );
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    {/* Background glow effect on hover */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

                    {/* Left side: Icon + Account name */}
                    <div className="flex items-center gap-2 flex-1 min-w-0 relative z-10">
                      <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                        <PaliWhiteSmallIconSvg className="w-7 h-7 text-brand-gray300 opacity-80 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300" />
                      </div>
                      <span className="group-hover:text-white transition-colors duration-300 truncate">
                        {account.label} ({ellipsis(account.address, 4, 4)})
                      </span>
                    </div>

                    {/* Right side: Badge + Checkmark */}
                    <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
                      {switchingAccount?.id === account.id &&
                      switchingAccount?.type ===
                        KeyringAccountType.HDAccount ? (
                        <LoadingSvg className="w-4 h-4 text-brand-royalblue" />
                      ) : (
                        <>
                          <span className="text-xs px-2 py-0.5 text-white bg-brand-royalblue rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-brand-blue500 transform group-hover:scale-105 transition-all duration-300">
                            Pali
                          </span>
                          {activeAccount.id === account.id &&
                            activeAccount.type ===
                              KeyringAccountType.HDAccount && (
                              <div className="transform group-hover:scale-110 transition-transform duration-300">
                                <Icon
                                  name="check"
                                  className="w-4 h-4"
                                  color="#8EC100"
                                />
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </li>
                ))}

              {Object.values(accounts.Imported)
                .filter((acc) => !acc.address.startsWith('0x'))
                .map((account, index) => (
                  <li
                    className={`group relative py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                  font-medium hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 active:bg-brand-blue700 active:scale-[0.98] focus:outline-none cursor-pointer transform
                   transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-blue600/20 ${
                     switchingAccount ? 'pointer-events-none opacity-60' : ''
                   }`}
                    onClick={() => {
                      if (switchingAccount) return;
                      handleAccountSwitch(
                        account.id,
                        KeyringAccountType.Imported,
                        close
                      );
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    {/* Background glow effect on hover */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>

                    {/* Left side: Icon + Account name */}
                    <div className="flex items-center gap-2 flex-1 min-w-0 relative z-10">
                      <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                        <PaliWhiteSmallIconSvg className="w-7 h-7 text-brand-gray300 opacity-80 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300" />
                      </div>
                      <span className="group-hover:text-white transition-colors duration-300 truncate">
                        {account.label} ({ellipsis(account.address, 4, 4)})
                      </span>
                    </div>

                    {/* Right side: Badge + Checkmark */}
                    <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
                      {switchingAccount?.id === account.id &&
                      switchingAccount?.type === KeyringAccountType.Imported ? (
                        <LoadingSvg className="w-4 h-4 text-orange-500" />
                      ) : (
                        <>
                          <span className="text-xs px-2 py-0.5 text-white bg-orange-500 rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-orange-400 transform group-hover:scale-105 transition-all duration-300">
                            Imported
                          </span>
                          {activeAccount.id === account.id &&
                            activeAccount.type ===
                              KeyringAccountType.Imported && (
                              <div className="transform group-hover:scale-110 transition-transform duration-300">
                                <Icon
                                  name="check"
                                  className="w-4 h-4"
                                  color="#8EC100"
                                />
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </li>
                ))}

              {Object.values(accounts.Trezor)
                .filter((acc) => acc.isImported === false)
                .map((account, index) => (
                  <li
                    className={`group relative py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                  font-medium active:bg-brand-blue700 active:scale-[0.98] focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'hidden'
                      : `cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 ${
                          switchingAccount
                            ? 'pointer-events-none opacity-60'
                            : ''
                        }`
                  } transform`}
                    onClick={() => {
                      if (
                        account?.originNetwork.url !== activeNetwork.url ||
                        switchingAccount
                      ) {
                        return;
                      }
                      handleAccountSwitch(
                        account.id,
                        KeyringAccountType.Trezor,
                        close
                      );
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    {/* Background glow effect on hover */}
                    {account?.originNetwork.url === activeNetwork.url && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>
                    )}

                    {/* Left side: Icon + Account name */}
                    <div className="flex items-center gap-2 flex-1 min-w-0 relative z-10">
                      <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                        <img
                          src={trezorLogo}
                          alt=""
                          style={{
                            filter:
                              'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                          }}
                          className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
                        />
                      </div>
                      <span className="group-hover:text-white transition-colors duration-300 truncate">
                        {account.label}{' '}
                        {!(account?.originNetwork.url !== activeNetwork.url) &&
                          `(${ellipsis(account.address, 4, 4)})`}
                      </span>
                    </div>

                    {/* Right side: Badge + Checkmark */}
                    <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
                      {switchingAccount?.id === account.id &&
                      switchingAccount?.type === KeyringAccountType.Trezor ? (
                        <LoadingSvg className="w-4 h-4 text-green-500" />
                      ) : (
                        <>
                          <span className="text-xs px-2 py-0.5 text-white bg-green-500 rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-green-400 transform group-hover:scale-105 transition-all duration-300">
                            Trezor
                          </span>
                          {activeAccount.id === account.id &&
                            activeAccount.type ===
                              KeyringAccountType.Trezor && (
                              <div className="transform group-hover:scale-110 transition-transform duration-300">
                                <Icon
                                  name="check"
                                  className="w-4 h-4"
                                  color="#8EC100"
                                />
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </li>
                ))}

              {Object.values(accounts.Ledger)
                .filter((acc) => acc.isImported === false)
                .map((account, index) => (
                  <li
                    className={`group relative py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
                  font-medium active:bg-brand-blue700 active:scale-[0.98] focus:outline-none ${
                    account?.originNetwork.url !== activeNetwork.url
                      ? 'hidden'
                      : `cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 ${
                          switchingAccount
                            ? 'pointer-events-none opacity-60'
                            : ''
                        }`
                  } transform`}
                    onClick={() => {
                      if (
                        account?.originNetwork.url !== activeNetwork.url ||
                        switchingAccount
                      ) {
                        return;
                      }
                      handleAccountSwitch(
                        account.id,
                        KeyringAccountType.Ledger,
                        close
                      );
                    }}
                    id={`account-${index}`}
                    key={account.id}
                  >
                    {/* Background glow effect on hover */}
                    {account?.originNetwork.url === activeNetwork.url && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>
                    )}

                    {/* Left side: Icon + Account name */}
                    <div className="flex items-center gap-2 flex-1 min-w-0 relative z-10">
                      <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                        <img
                          src={ledgerLogo}
                          alt=""
                          style={{
                            filter:
                              'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                          }}
                          className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
                        />
                      </div>
                      <span className="group-hover:text-white transition-colors duration-300 truncate">
                        {account.label}{' '}
                        {!(account?.originNetwork.url !== activeNetwork.url) &&
                          `(${ellipsis(account.address, 4, 4)})`}
                      </span>
                    </div>

                    {/* Right side: Badge + Checkmark */}
                    <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
                      {switchingAccount?.id === account.id &&
                      switchingAccount?.type === KeyringAccountType.Ledger ? (
                        <LoadingSvg className="w-4 h-4 text-blue-500" />
                      ) : (
                        <>
                          <span className="text-xs px-2 py-0.5 text-white bg-blue-500 rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-blue-400 transform group-hover:scale-105 transition-all duration-300">
                            Ledger
                          </span>
                          {activeAccount.id === account.id &&
                            activeAccount.type ===
                              KeyringAccountType.Ledger && (
                              <div className="transform group-hover:scale-110 transition-transform duration-300">
                                <Icon
                                  name="check"
                                  className="w-4 h-4"
                                  color="#8EC100"
                                />
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
            </>
          ) : (
            Object.entries(accounts).map(
              ([keyringAccountType, accountTypeAccounts]) =>
                Object.values(accountTypeAccounts)
                  .filter((account) => account.address.startsWith('0x'))
                  .map((account, index) => (
                    <li
                      className={`group relative py-1.5 px-5 w-full backface-visibility-hidden flex items-center justify-between text-white text-sm 
              font-medium active:bg-brand-blue700 active:scale-[0.98] focus:outline-none ${
                (account.isTrezorWallet &&
                  account?.originNetwork?.isBitcoinBased) ||
                (account.isLedgerWallet &&
                  account?.originNetwork?.isBitcoinBased)
                  ? 'hidden'
                  : `cursor-pointer hover:bg-gradient-to-r hover:from-brand-blue600 hover:to-brand-blue500 transition-all duration-300 ease-in-out hover:shadow-lg hover:shadow-brand-blue600/20 ${
                      switchingAccount ? 'pointer-events-none opacity-60' : ''
                    }`
              } transform`}
                      onClick={() => {
                        if (
                          (account.isTrezorWallet &&
                            account?.originNetwork?.isBitcoinBased) ||
                          (account.isLedgerWallet &&
                            account?.originNetwork?.isBitcoinBased) ||
                          switchingAccount
                        ) {
                          return;
                        }
                        handleAccountSwitch(
                          account.id,
                          keyringAccountType as KeyringAccountType,
                          close
                        );
                      }}
                      id={`account-${index}`}
                      key={`${keyringAccountType}-${account.id}`}
                    >
                      {/* Background glow effect on hover */}
                      {!(
                        (account.isTrezorWallet &&
                          account?.originNetwork?.isBitcoinBased) ||
                        (account.isLedgerWallet &&
                          account?.originNetwork?.isBitcoinBased)
                      ) && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-blue600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg"></div>
                      )}

                      {/* Left side: Icon + Account name */}
                      <div className="flex items-center gap-2 flex-1 min-w-0 relative z-10">
                        <div className="transform group-hover:scale-110 transition-transform duration-300 ease-out">
                          {account.isImported ? (
                            <img
                              src={importIcon}
                              className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
                              alt=""
                            />
                          ) : account.isTrezorWallet ? (
                            <img
                              src={trezorLogo}
                              alt=""
                              style={{
                                filter:
                                  'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                              }}
                              className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
                            />
                          ) : account.isLedgerWallet ? (
                            <img
                              src={ledgerLogo}
                              alt=""
                              style={{
                                filter:
                                  'invert(100%) sepia(0%) saturate(0%) hue-rotate(44deg) brightness(108%) contrast(102%)',
                              }}
                              className="w-7 h-7 group-hover:brightness-110 transition-all duration-300"
                            />
                          ) : (
                            <PaliWhiteSmallIconSvg className="w-7 h-7 text-brand-gray300 opacity-80 group-hover:opacity-100 group-hover:text-brand-white transition-all duration-300" />
                          )}
                        </div>
                        <span className="group-hover:text-white transition-colors duration-300 truncate">
                          {account.label}{' '}
                          {!(
                            (account.isTrezorWallet &&
                              account?.originNetwork?.isBitcoinBased) ||
                            (account.isLedgerWallet &&
                              account?.originNetwork?.isBitcoinBased)
                          ) && `(${ellipsis(account.address, 4, 4)})`}
                        </span>
                      </div>

                      {/* Right side: Badge + Checkmark */}
                      <div className="flex items-center gap-2 flex-shrink-0 relative z-10">
                        {switchingAccount?.id === account.id &&
                        switchingAccount?.type === keyringAccountType ? (
                          <LoadingSvg
                            className={`w-4 h-4 ${
                              account.isImported
                                ? 'text-orange-500'
                                : account.isTrezorWallet
                                ? 'text-green-500'
                                : account.isLedgerWallet
                                ? 'text-blue-500'
                                : 'text-brand-royalblue'
                            }`}
                          />
                        ) : (
                          <>
                            {account.isImported ? (
                              <span className="text-xs px-2 py-0.5 text-white bg-orange-500 rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-orange-400 transform group-hover:scale-105 transition-all duration-300">
                                Imported
                              </span>
                            ) : account.isTrezorWallet ? (
                              <span className="text-xs px-2 py-0.5 text-white bg-green-500 rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-green-400 transform group-hover:scale-105 transition-all duration-300">
                                Trezor
                              </span>
                            ) : account.isLedgerWallet ? (
                              <span className="text-xs px-2 py-0.5 text-white bg-blue-500 rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-blue-400 transform group-hover:scale-105 transition-all duration-300">
                                Ledger
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 text-white bg-brand-royalblue rounded-full font-medium shadow-sm group-hover:shadow-md group-hover:bg-brand-blue500 transform group-hover:scale-105 transition-all duration-300">
                                Pali
                              </span>
                            )}
                            {activeAccount.id === account.id &&
                              activeAccount.type === keyringAccountType && (
                                <div className="transform group-hover:scale-110 transition-transform duration-300">
                                  <Icon
                                    name="check"
                                    className="w-4 h-4"
                                    color="#8EC100"
                                  />
                                </div>
                              )}
                          </>
                        )}
                      </div>
                    </li>
                  ))
            )
          )}
        </>
      )}
    </Menu.Item>
  );
};

export default RenderAccountsListByBitcoinBased;
