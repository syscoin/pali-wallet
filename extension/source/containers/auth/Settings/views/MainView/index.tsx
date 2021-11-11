import React, { FC, useEffect} from 'react';
// import { useSelector } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
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

// import {
//   ACCOUNT_VIEW,
//   CONNECT_HARDWARE_WALLET_VIEW,
//   GENERAL_VIEW,
//   NEW_ACCOUNT_VIEW,
//   PRIV_KEY_VIEW,
//   AUTOLOCK_VIEW,
//   PHRASE_VIEW,
//   ABOUT_VIEW
// } from '../routes';

interface IMainView {
  accountSettings?: boolean;
  generalSettings?: boolean;
  // onChange: (id: string) => void;
  onClose?: any;
}

const MainView: FC<IMainView> = ({ onClose, accountSettings, generalSettings }) => {
  const showView = useSettingsView();
  const history = useHistory();
  const controller = useController();
  const location = useLocation();
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

  const handleShowView = (pathname: string) => {
    history.push(pathname);
  }

  return (
    <div >
      {generalSettings && (
        <ul>
          <li onClick={() => onClose({ pathname: '/general-autolock' })}>
            {/* <span onClick={() => history.push('/general-autolock')}> */}
              <Icon Component={AddIcon} />
              Auto lock timer
            {/* </span> */}
          </li>

          <li
            onClick={() => history.push('/general-phrase')}
          >
            <Icon Component={SettingsInputHdmiIcon} />
            Wallet Seed Phrase
          </li>

          <li
            onClick={() => history.push('/general-about')}
          >
            <Icon Component={SettingsIcon} />
            Info/Help
          </li>
        </ul>
      )}

      {accountSettings && (
        <ul>
          <li
            onClick={() => history.push('/account-priv')}
          >
            <Icon Component={AddIcon} />
            XPUB
          </li>

          <li
            onClick={() => history.push('/account-details')}
          >
            <Icon Component={SettingsInputHdmiIcon} />
            Accounts
          </li>

          <li
            onClick={() => history.push('/account-newaccount')}
          >
            <Icon Component={SettingsInputHdmiIcon} />
            new account
          </li>

          <li
            onClick={() => history.push('/account-hardware')}
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
        </ul>
      )}
    </div>
  );
};

export default MainView;
