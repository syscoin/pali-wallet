import React, { FC } from 'react';
import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import AddIcon from '@material-ui/icons/Add';
import ImportIcon from '@material-ui/icons/ImportExport';
import SettingsIcon from '@material-ui/icons/Settings';
import LogOutIcon from '@material-ui/icons/ExitToApp';
import ContactsIcon from '@material-ui/icons/Group';
import UserIcon from '@material-ui/icons/AccountCircleRounded';

import Icon from 'components/Icon';
import { useController, useSettingsView } from 'hooks/index';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import AccountSelect from 'components/AccountSelect';
import {
  ACCOUNT_VIEW,
  CONTACTS_VIEW,
  GENERAL_VIEW,
  IMPORT_ACCOUNT_VIEW,
  NEW_ACCOUNT_VIEW,
} from '../routes';

import styles from './index.scss';

interface IMainView {
  onChange: (id: string) => void;
}

const MainView: FC<IMainView> = ({ onChange }) => {
  const showView = useSettingsView();
  const history = useHistory();
  const controller = useController();
  const { accounts, activeAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const handleSelectAccount = (id: string) => {
    onChange(id);
    showView(ACCOUNT_VIEW);
  };

  const handleLogout = () => {
    controller.wallet.logOut();
    history.push('/app.html');
  };

  return (
    <div className={styles.main}>
      <ul className={styles.accounts}>
        <AccountSelect
          label={
            <>
              <Icon Component={UserIcon} />
              Accounts
            </>
          }
          value={String(activeAccountId)}
          options={accounts}
          onChange={async (val: string) => {
            handleSelectAccount(val);
          }}
        />
      </ul>
      <section
        className={styles.new}
        onClick={() => showView(NEW_ACCOUNT_VIEW)}
      >
        <Icon Component={AddIcon} />
        Create seed account
      </section>
      <section
        className={styles.general}
        onClick={() => showView(IMPORT_ACCOUNT_VIEW)}
      >
        <Icon Component={ImportIcon} />
        Import private key
      </section>
      <section
        className={styles.general}
        onClick={() => showView(CONTACTS_VIEW)}
      >
        <Icon Component={ContactsIcon} />
        Contacts
      </section>
      <section
        className={styles.general}
        onClick={() => showView(GENERAL_VIEW)}
      >
        <Icon Component={SettingsIcon} />
        General settings
      </section>
      <section className={styles.general} onClick={handleLogout}>
        <Icon Component={LogOutIcon} />
        Log out
      </section>
    </div>
  );
};

export default MainView;
