import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { IconButton, Layout, Icon, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { truncate } from 'utils/index';

const ManageAccountsView = () => {
  const accounts = useSelector((state: RootState) => state.vault.accounts);

  const { navigate } = useUtils();
  const { t } = useTranslation();
  const editAccount = (account: IKeyringAccountState) => {
    navigate('/settings/edit-account', {
      state: account,
    });
  };

  const existImportedAccounts = Boolean(
    Object.values(accounts.Imported).length > 0
  );
  const existTrezorAccounts = Boolean(
    Object.values(accounts.Trezor).length > 0
  );

  return (
    <Layout title={t('settings.manageAccounts')}>
      <ul className="scrollbar-styled mb-4 w-full h-80 text-sm overflow-auto md:h-96">
        <p className="py-1 text-center text-brand-white text-xs font-bold bg-bkg-4">
          {t('settings.hdAccounts')}
        </p>
        {Object.values(accounts.HDAccount).map(
          (account: IKeyringAccountState) => (
            <li
              key={account.id}
              className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
            >
              <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
                <span>{truncate(account.label, 25)}</span>
              </div>

              <div className="flex gap-x-3 items-center justify-between">
                <IconButton
                  onClick={() => editAccount(account)}
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="edit"
                    className="hover:text-brand-royalblue text-xl"
                  />
                </IconButton>
              </div>
            </li>
          )
        )}
        {existImportedAccounts ? (
          <>
            <p className="py-1 text-center text-brand-white text-xs font-bold bg-bkg-4">
              {t('settings.importedAccounts')}
            </p>
            {Object.values(accounts.Imported).map(
              (account: IKeyringAccountState) => (
                <li
                  key={account.id}
                  className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
                >
                  <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
                    <span>{truncate(account.label, 25)}</span>
                  </div>

                  <div className="flex gap-x-3 items-center justify-between">
                    <IconButton
                      onClick={() => editAccount(account)}
                      type="primary"
                      shape="circle"
                    >
                      <Icon
                        name="edit"
                        className="hover:text-brand-royalblue text-xl"
                      />
                    </IconButton>
                  </div>
                </li>
              )
            )}
          </>
        ) : null}

        {existTrezorAccounts ? (
          <>
            <p className="py-1 text-center text-brand-white text-xs font-bold bg-bkg-4">
              {t('settings.trezorAccounts')}
            </p>
            {Object.values(accounts.Trezor).map(
              (account: IKeyringAccountState) => (
                <li
                  key={account.id}
                  className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
                >
                  <div className="flex flex-col gap-x-3 items-start justify-start text-xs">
                    <span>{truncate(account.label, 25)}</span>
                  </div>

                  <div className="flex gap-x-3 items-center justify-between">
                    <IconButton
                      onClick={() => editAccount(account)}
                      type="primary"
                      shape="circle"
                    >
                      <Icon
                        name="edit"
                        className="hover:text-brand-royalblue text-xl"
                      />
                    </IconButton>
                  </div>
                </li>
              )
            )}
          </>
        ) : null}
      </ul>

      <NeutralButton type="button" onClick={() => navigate('/home')}>
        {t('buttons.close')}
      </NeutralButton>
    </Layout>
  );
};

export default ManageAccountsView;
