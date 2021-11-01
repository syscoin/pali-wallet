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
  // ACCOUNT_VIEW,
  CONNECT_HARDWARE_WALLET_VIEW,
  GENERAL_VIEW,
  NEW_ACCOUNT_VIEW,
} from '../routes';

interface IMainView {
  onChange: (id: string) => void;
}

const MainView: FC<IMainView> = ({ }) => {
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
      <ul >
        {/* <AccountSelect
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
        /> */}
      </ul>
      <section
        onClick={() => showView(NEW_ACCOUNT_VIEW)}
      >
        <Icon Component={AddIcon} />
        Create new account
      </section>

      <section
        onClick={() => showView(CONNECT_HARDWARE_WALLET_VIEW)}
      >
        <Icon Component={SettingsInputHdmiIcon} />
        Connect hardware wallet
      </section>

      <section
        onClick={() => showView(GENERAL_VIEW)}
      >
        <Icon Component={SettingsIcon} />
        General settings
      </section>
      <section  onClick={handleLogout}>
        <Icon Component={LogOutIcon} />
        Lock
      </section>
    </div>
  );
};

export default MainView;
