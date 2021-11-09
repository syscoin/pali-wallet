import React, { FC } from 'react';
// import { useSelector } from 'react-redux';
import { useHistory } from 'react-router-dom';
import AddIcon from '@material-ui/icons/Add';
import SettingsIcon from '@material-ui/icons/Settings';
import LogOutIcon from '@material-ui/icons/ExitToApp';
import SettingsInputHdmiIcon from '@material-ui/icons/SettingsInputHdmi';
// import UserIcon from '@material-ui/icons/AccountCircleRounded';
import Icon from 'components/Icon';
import { useController, useSettingsView } from 'hooks/index';
// import { RootState } from 'state/store';
// import IWalletState from 'state/wallet/types';
// import AccountSelect from 'components/AccountSelect';

import {
  ACCOUNT_VIEW,
  CONNECT_HARDWARE_WALLET_VIEW,
  GENERAL_VIEW,
  NEW_ACCOUNT_VIEW,
  PRIV_KEY_VIEW,
  AUTOLOCK_VIEW,
  PHRASE_VIEW,
  ABOUT_VIEW
} from '../routes';

interface IMainView {
  accountSettings: boolean;
  generalSettings: boolean;
  onChange: (id: string) => void;
}

const MainView: FC<IMainView> = ({ accountSettings, generalSettings }) => {
  const showView = useSettingsView();
  const history = useHistory();
  const controller = useController();
  // const { accounts, activeAccountId }: IWalletState = useSelector(
  //   (state: RootState) => state.wallet
  // );

  // const handleSelectAccount = (id: string) => {
  //   onChange(id);
  //   showView(ACCOUNT_VIEW);
  // };

  const handleLogout = () => {
    controller.wallet.logOut();
    history.push('/app.html');
  };

  return (
    <div >
      {/* <ul >
        <AccountSelect
          label={
            <>
              <Icon Component={UserIcon} />
              Accounts
            </>
          }
          value={String(activeAccountId)}
          options={accounts}
          onChange={(val: string) => {
            handleSelectAccount(val);
          }}
        />
      </ul> */}

      {/* <section  onClick={handleLogout}>
        <Icon Component={LogOutIcon} />
        Fiat Currency
      </section> */}

      {generalSettings && (
        <ul>
          <li
            onClick={() => showView(AUTOLOCK_VIEW)}
          >
            <Icon Component={AddIcon} />
            Auto lock timer
          </li>

          <li
            onClick={() => showView(PHRASE_VIEW)}
          >
            <Icon Component={SettingsInputHdmiIcon} />
            Wallet Seed Phrase
          </li>

          <li
            onClick={() => showView(ABOUT_VIEW)}
          >
            <Icon Component={SettingsIcon} />
            Info/Help
          </li>
        </ul>
      )}

      {accountSettings && (
        <ul>
          <li
            onClick={() => showView(PRIV_KEY_VIEW)}
          >
            <Icon Component={AddIcon} />
            XPUB
          </li>

          <li
            onClick={() => showView(ACCOUNT_VIEW)}
          >
            <Icon Component={SettingsInputHdmiIcon} />
            Accounts
          </li>

          <li
            onClick={() => showView(CONNECT_HARDWARE_WALLET_VIEW)}
          >
            <Icon Component={SettingsIcon} />
            Connect hardware wallet
          </li>

          <li
            onClick={handleLogout}
          >
            <Icon Component={SettingsIcon} />
            Lock
          </li>

          {/* <li
          onClick={() => showView(NEW_ACCOUNT_VIEW)}
        >
          <Icon Component={SettingsIcon} />
          new account
        </li> */}
        </ul>
      )}
    </div>
  );
};

export default MainView;
