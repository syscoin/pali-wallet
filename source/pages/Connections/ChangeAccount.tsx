import { isHexString } from 'ethers/lib/utils';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { Layout, SecondaryButton, PrimaryButton, Icon } from 'components/index';
import { useQueryData } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const ChangeAccount = () => {
  const { controllerEmitter } = useController();
  const { accounts, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const { host, eventName } = useQueryData();
  const { t } = useTranslation();

  let currentAccountId: number;
  let currentAccountType: KeyringAccountType;

  controllerEmitter(['dapp', 'get'], [host]).then((res: any) => {
    currentAccountId = res?.accountId;
    currentAccountType = res?.accountType;
  });

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
    if (eventName === 'requestPermissions') {
      controllerEmitter(
        ['dapp', 'requestPermissions'],
        [host, accountId, accountType]
      );
    } else {
      controllerEmitter(
        ['dapp', 'changeAccount'],
        [host, accountId, accountType]
      );
    }

    controllerEmitter(['wallet', 'setAccount'], [accountId, accountType]);

    const response = { accountId, accountType };

    dispatchBackgroundEvent(`${eventName}.${host}`, response);

    window.close();
  };

  return (
    <Layout
      canGoBack={false}
      title={t('connections.connectedAccount')}
      titleOnly={true}
    >
      <div className="h-80 flex flex-col gap-7 items-center justify-center mt-6 w-full">
        {accounts && Object.keys(accounts).length > 0 ? (
          <>
            {Object.entries(accounts).map(([keyringAccountType, account]) => {
              const isValidAccount = (currentAccount: any) =>
                isBitcoinBased
                  ? !isHexString(currentAccount.address)
                  : isHexString(currentAccount.address);

              let accountList = Object.values(account).filter(isValidAccount);

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
                  className="h-80 overflow-auto scrollbar-styled flex flex-col text-center"
                >
                  <h3 className="text-sm font-semibold">
                    {keyringAccountType === KeyringAccountType.HDAccount
                      ? 'Pali Account'
                      : keyringAccountType}
                  </h3>
                  <ul
                    className={`scrollbar-styled flex flex-col gap-4 mt-4 px-8 w-full h-full overflow-auto`}
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

        <small className="absolute bottom-32 text-center text-brand-royalblue text-sm">
          {t('connections.onlyConnect')}{' '}
          <a href="https://docs.syscoin.org/">{t('connections.learnMore')}</a>
        </small>

        <div className="absolute bottom-14 flex items-center justify-between px-10 w-full md:max-w-2xl">
          <SecondaryButton type="button" onClick={() => window.close()}>
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="button"
            width="40"
            onClick={() => handleChangeAccount()}
          >
            {t('buttons.change')}
          </PrimaryButton>
        </div>
      </div>
    </Layout>
  );
};
