import React from 'react';
import { useTranslation } from 'react-i18next';
import { AiOutlineUsb } from 'react-icons/ai';
import { RiUserReceivedLine } from 'react-icons/ri/';
import { useSelector } from 'react-redux';

import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';

import logo from 'assets/images/whiteLogo.png';
import { IconButton, Layout, Icon, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';

const ManageAccountsView = () => {
  const accounts = useSelector((state: RootState) => state.vault.accounts);

  const { navigate } = useUtils();
  const { t } = useTranslation();
  const editAccount = (account: IKeyringAccountState) => {
    navigate('/settings/edit-account', {
      state: account,
    });
  };
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const existImportedAccounts = Boolean(
    Object.values(accounts.Imported).length > 0
  );
  const existTrezorAccounts = Boolean(
    Object.values(accounts.Trezor).length > 0
  );

  return (
    <Layout title={t('settings.manageAccounts')}>
      <ul className="scrollbar-styled mb-4 w-full h-80 text-sm overflow-auto md:h-96">
        {Object.values(accounts.HDAccount).map(
          (account: IKeyringAccountState) => (
            <li
              key={account.id}
              className={`my-3 py-2 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
            >
              <div className="flex items-center">
                <span
                  style={{ maxWidth: '16.25rem', textOverflow: 'ellipsis' }}
                  className="w-max  flex items-center justify-start whitespace-nowrap overflow-hidden"
                >
                  <img src={logo} className="mr-1 w-7"></img>
                  {account.label} ({ellipsis(account.address, 4, 4)})
                </span>
                <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                  Pali
                </span>
                {activeAccount.id === account.id &&
                  activeAccount.type === KeyringAccountType.HDAccount && (
                    <Icon name="greenCheck" isSvg className="ml-2 w-4" />
                  )}
              </div>
              <div className="flex gap-x-3 items-center justify-between">
                <IconButton
                  onClick={() => editAccount(account)}
                  type="primary"
                  shape="circle"
                >
                  <Icon
                    name="edit"
                    size={20}
                    className="hover:text-brand-royalblue text-xl"
                  />
                </IconButton>
              </div>
            </li>
          )
        )}
        {existImportedAccounts ? (
          <>
            {Object.values(accounts.Imported).map(
              (account: IKeyringAccountState) => (
                <li
                  key={account.id}
                  className={`my-3 py-1 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
                >
                  <div className="flex items-center">
                    <span
                      style={{
                        maxWidth: '16.25rem',
                        textOverflow: 'ellipsis',
                      }}
                      className="w-max flex items-center justify-start whitespace-nowrap overflow-hidden"
                    >
                      <RiUserReceivedLine size={20} className="mr-1" />
                      {account.label} ({ellipsis(account.address, 4, 4)})
                    </span>
                    <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                      Imported
                    </span>
                    {activeAccount.id === account.id &&
                      activeAccount.type === KeyringAccountType.Imported && (
                        <Icon name="greenCheck" isSvg className="ml-2 w-4" />
                      )}
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
            {Object.values(accounts.Trezor).map(
              (account: IKeyringAccountState) => (
                <li
                  key={account.id}
                  className={`my-3 w-full flex justify-between items-center transition-all duration-300 border-b border-dashed border-dashed-light cursor-default`}
                >
                  <div className="flex items-center">
                    <span
                      style={{
                        maxWidth: '16.25rem',
                        textOverflow: 'ellipsis',
                      }}
                      className="w-max flex items-center justify-start whitespace-nowrap overflow-hidden"
                    >
                      <AiOutlineUsb size={20} className="mr-1" />
                      {account.label} ({ellipsis(account.address, 4, 4)})
                    </span>
                    <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                      Trezor
                    </span>
                    {activeAccount.id === account.id &&
                      activeAccount.type === KeyringAccountType.Trezor && (
                        <Icon name="greenCheck" isSvg className="ml-2 w-4" />
                      )}
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
      <div className="w-full px-4 absolute bottom-12 md:static">
        <NeutralButton
          type="button"
          fullWidth
          onClick={() => navigate('/home')}
        >
          {t('buttons.close')}
        </NeutralButton>{' '}
      </div>
    </Layout>
  );
};

export default ManageAccountsView;
