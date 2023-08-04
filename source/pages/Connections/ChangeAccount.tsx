import React, { useState } from 'react';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { Layout, SecondaryButton, PrimaryButton, Icon } from 'components/index';
import { useQueryData, useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent, getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeAccount = () => {
  const { accounts, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const { dapp, wallet } = getController();
  const { host, eventName } = useQueryData();

  const currentAccountId = dapp.get(host).accountId;
  const currentAccountType = dapp.get(host).accountType;
  const [accountId, setAccountId] = useState<number>(currentAccountId);
  const [accountType, setCurrentAccountType] =
    useState<KeyringAccountType>(currentAccountType);

  const handleSetAccountId = (id: number, type: KeyringAccountType) => {
    setAccountId(id);
    setCurrentAccountType(type);
  };

  const handleChangeAccount = () => {
    if (accountId === currentAccountId && accountType === currentAccountType) {
      const response = { accountId, accountType };
      dispatchBackgroundEvent(`${eventName}.${host}`, response);
      window.close();
      return;
    }
    //this should be passed to constant instead of being hardcoded
    if (eventName === 'requestPermissions')
      dapp.requestPermissions(host, accountId, accountType);
    else dapp.changeAccount(host, accountId, accountType);
    wallet.setAccount(accountId, accountType);
    const response = { accountId, accountType };
    dispatchBackgroundEvent(`${eventName}.${host}`, response);
    window.close();
  };

  return (
    <Layout canGoBack={false} title="CONNECTED ACCOUNT" titleOnly={true}>
      <div className="flex flex-col gap-7 items-center justify-center w-full">
        {accounts && Object.keys(accounts).length > 0 ? (
          <>
            {Object.entries(accounts).map(([keyringAccountType, account]) => {
              if (
                isBitcoinBased &&
                keyringAccountType === KeyringAccountType.Imported
              ) {
                return null;
              }

              let accountList = Object.values(account);

              if (!accountList.length) return null;

              switch (keyringAccountType) {
                case KeyringAccountType.Trezor:
                  if (!isBitcoinBased) {
                    for (const acc of accountList) {
                      const networkKeys = Object.keys(acc.originNetwork);

                      if (networkKeys.includes('slip44')) {
                        accountList = accountList.filter((ac) => ac !== acc);
                      }
                    }
                  } else {
                    for (const acc of accountList) {
                      const networkKeys = Object.keys(acc.originNetwork);

                      if (!networkKeys.includes('slip44')) {
                        accountList = accountList.filter((ac) => ac !== acc);
                      }
                    }
                  }
                  break;
              }
              return (
                <div
                  key={keyringAccountType}
                  className="h-fit flex flex-col text-center"
                >
                  <h3 className="text-sm font-semibold">
                    {keyringAccountType === KeyringAccountType.HDAccount
                      ? 'Pali Account'
                      : keyringAccountType}
                  </h3>
                  <ul
                    className={`scrollbar-styled flex flex-col gap-4 mt-4 px-8 w-full h-${
                      accountList.length === 1 || accountList.length === 2
                        ? 'fit'
                        : '32'
                    } overflow-auto`}
                  >
                    {accountList.map((acc) => (
                      <li
                        className={`${
                          acc.id === currentAccountId &&
                          accountType === keyringAccountType
                            ? 'cursor-not-allowed bg-opacity-50 border-brand-royalblue'
                            : 'cursor-pointer hover:bg-bkg-4 border-brand-royalblue'
                        } border border-solid  rounded-lg px-2 py-4 text-xs bg-bkg-2 w-48 flex justify-between items-center transition-all duration-200`}
                        key={`${acc.id}-${keyringAccountType}`}
                        onClick={() => {
                          handleSetAccountId(
                            acc.id,
                            keyringAccountType as KeyringAccountType
                          );
                        }}
                      >
                        <p>{acc.label}</p>

                        <div className="flex gap-3 items-center justify-center">
                          <small>{ellipsis(acc.address)}</small>

                          <div
                            className={`${
                              acc.id === accountId &&
                              accountType === keyringAccountType
                                ? 'bg-warning-success'
                                : 'bg-brand-graylight'
                            } w-3 h-3 rounded-full border border-brand-royalblue`}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </>
        ) : (
          <div>
            <Icon name="loading" className="w-4 text-brand-graylight" />
          </div>
        )}

        <small className="absolute bottom-28 text-center text-brand-royalblue text-sm">
          Only connect with sites you trust.{' '}
          <a href="https://docs.syscoin.org/">Learn more.</a>
        </small>

        <div className="absolute bottom-10 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton type="button" onClick={() => window.close()}>
            Cancel
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            onClick={() => handleChangeAccount()}
          >
            Change
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
