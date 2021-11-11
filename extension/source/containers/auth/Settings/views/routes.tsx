// export const MAIN_VIEW = '#';
// export const ACCOUNT_VIEW = '#account';
// export const GENERAL_VIEW = '#general';
// export const PHRASE_VIEW = '#phrase';
// export const DELETE_WALLET_VIEW = '#delete_wallet';
// export const NEW_ACCOUNT_VIEW = '#new_account';
// export const PRIV_KEY_VIEW = '#private_key';
// export const ABOUT_VIEW = '#about';
// export const CONNECT_HARDWARE_WALLET_VIEW = '#connect_hardware_wallet_view';
// export const AUTOLOCK_VIEW = '#autolock_view';

import React, { useEffect, FC } from 'react';
import { Switch, Route, useLocation, useHistory } from 'react-router-dom';
import { useController } from 'hooks/index';
import {
  AboutView,
  AccountView,
  AutolockView,
  ConnectHardwareWalletView,
  DeleteWalletView,
  MainView,
  NewAccountView,
  PhraseView,
  PrivateKeyView
} from 'containers/auth/Settings/views';

interface ISettings {
  accountSettings?: boolean;
  generalSettings?: boolean;
}

const Settings: FC<ISettings> = ({ accountSettings = false, generalSettings = false }) => {
  const location = useLocation();
  const history = useHistory();
  const controller = useController();

  useEffect(() => {
    const redirectRoute = controller.appRoute();

    history.push(redirectRoute);
  }, []);

  useEffect(() => {
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <>
      <div>
        <Switch>
          <Route
            path='/general'
            render={(props) => (
              <MainView {...props} accountSettings={accountSettings} generalSettings={generalSettings} />
            )}
            exact
          />
          <Route path="/general-autolock" component={AutolockView} exact />
          <Route path="/general-about" component={AboutView} exact />
          <Route path="/general-phrase" component={PhraseView} exact />
          <Route path="/general-delete" component={DeleteWalletView} exact />

          <Route
            path='/account'
            render={(props) => (
              <MainView {...props} accountSettings={accountSettings} generalSettings={generalSettings} />
            )}
            exact
          />
          <Route
            path='/account-priv'
            render={(props) => (
              <PrivateKeyView {...props} id='0' />
            )}
            exact
          />
          <Route path="/account-hardware" component={ConnectHardwareWalletView} exact />
          <Route path="/account-newaccount" component={NewAccountView} exact />
          <Route path="/account-details" component={AccountView} exact />
        </Switch>
      </div>
    </>
  );
};

export default Settings;
