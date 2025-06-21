import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AiOutlineUsb } from 'react-icons/ai';
import { RiUserReceivedLine } from 'react-icons/ri/';
import { useSelector } from 'react-redux';

import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';

import { PaliWhiteSmallIconSvg } from 'components/Icon/Icon';
import { IconButton, Layout, Icon, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';

const ManageAccountsView = () => {
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const activeAccountRef = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const { navigate } = useUtils();
  const { t } = useTranslation();

  const editAccount = useCallback(
    (account: IKeyringAccountState) => {
      navigate('/settings/edit-account', {
        state: account,
      });
    },
    [navigate]
  );

  const handleClose = useCallback(() => {
    navigate('/home');
  }, [navigate]);

  const accountTypeExists = useMemo(
    () => ({
      imported: Object.values(accounts.Imported).length > 0,
      trezor: Object.values(accounts.Trezor).length > 0,
      ledger: Object.values(accounts.Ledger).length > 0,
    }),
    [accounts.Imported, accounts.Trezor, accounts.Ledger]
  );

  const isActiveAccount = useCallback(
    (account: IKeyringAccountState, type: KeyringAccountType) =>
      activeAccountRef?.id === account.id && activeAccountRef?.type === type,
    [activeAccountRef?.id, activeAccountRef?.type]
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
                  <PaliWhiteSmallIconSvg className="mr-1 w-7 text-brand-gray300 opacity-80" />
                  {account.label} ({ellipsis(account.address, 4, 4)})
                </span>
                <span className="text-xs ml-2 px-2 py-0.5 text-white bg-brand-blue500 rounded-full">
                  Pali
                </span>
                {isActiveAccount(account, KeyringAccountType.HDAccount) && (
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
        {accountTypeExists.imported ? (
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
                    {isActiveAccount(account, KeyringAccountType.Imported) && (
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

        {accountTypeExists.trezor ? (
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
                    {isActiveAccount(account, KeyringAccountType.Trezor) && (
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
        <NeutralButton type="button" fullWidth onClick={handleClose}>
          {t('buttons.close')}
        </NeutralButton>{' '}
      </div>
    </Layout>
  );
};

export default ManageAccountsView;
