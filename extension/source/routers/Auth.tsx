import React, { useEffect } from 'react';
import { useAlert } from 'react-alert';
import {
  Switch,
  Route,
  Redirect,
  useLocation,
  useHistory,
} from 'react-router-dom';
import { useTransition, animated } from 'react-spring';
import Start from 'containers/auth/Start';
import Home from 'containers/auth/Home';
import Send, { SendConfirm } from 'containers/auth/Send';
import Receive from 'containers/auth/Receive';
import Import from 'containers/common/Import';
import ConnectWallet from 'containers/auth/ConnectWallet';
import ConfirmConnection from 'containers/auth/ConnectWallet/ConfirmConnection';
import ConnectedAccounts from 'containers/auth/ConnectWallet/ConnectedAccounts';
import { useController } from 'hooks/index';
import { SendMatchProps } from './types';
import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

const Auth = () => {
  const location = useLocation();
  const alert = useAlert();
  const history = useHistory();
  const controller = useController();
  const isUnlocked = !controller.wallet.isLocked();
  const transitions = useTransition(location, (locat) => locat.pathname, {
    initial: { opacity: 1 },
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0 },
    config: { duration: 200 },
  });
  const { isConnected, canConnect }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  useEffect(() => {
    const redirectRoute = controller.appRoute();

    if (redirectRoute == '/send/confirm' && !controller.wallet.account.getTempTx()) {
      history.push('/home');

      return;
    }

    if (canConnect && isUnlocked && !isConnected) {
      history.push('/connect-wallet');

      return;
    }

    // if (canConnect && isUnlocked && isConnected) {
    //   history.push('/connected-accounts');

    //   return;
    // }

    if (redirectRoute !== '/app.html') {
      history.push(redirectRoute);
    }
  }, [
    isConnected,
    canConnect,
    isUnlocked
  ]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <>
      {transitions.map(({ item, props, key }) => (
        <animated.div
          style={{
            ...props,
            position: 'absolute',
            height: '100%',
            width: '100%',
          }}
          key={key}
        >
          <Switch location={item}>
            <Route path="/app.html" component={Start} exact>
              {isUnlocked && <Redirect to="/home" />}
            </Route>
            {!isUnlocked && <Route path="/import" component={Import} exact />}
            {isUnlocked && <Route path="/home" component={Home} exact />}
            {isUnlocked && canConnect && !isConnected && <Route path="/connect-wallet" component={ConnectWallet} exact />}
            {isUnlocked && canConnect && !isConnected && <Route path="/confirm-connection" component={ConfirmConnection} exact />}
            {isUnlocked && canConnect && isConnected && <Route path="/connected-accounts" component={ConnectedAccounts} exact />}
            {isUnlocked && (
              <Route path="/send/confirm" component={SendConfirm} exact />
            )}
            {isUnlocked && <Route path="/send" component={Send} exact />}
            {isUnlocked && (
              <Route
                path="/send/:address"
                render={({ match }: SendMatchProps) => (
                  <Send initAddress={match.params.address} />
                )}
                exact
              />
            )}
            {isUnlocked && <Route path="/receive" component={Receive} exact />}
          </Switch>
        </animated.div>
      ))}
    </>
  );
};

export default Auth;
