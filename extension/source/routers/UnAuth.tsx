import React, { useEffect } from 'react';
import { Switch, Route, useLocation } from 'react-router-dom';
import { Import } from 'containers/common/Import';
import { useController, useUtils } from 'hooks/index';
import { CreatePhrase, ConfirmPhrase, Start, WelcomeWallet, CreatePass } from 'containers/unauth/index';

export const UnAuthRouter = () => {
  const location = useLocation();
  const controller = useController();
  const { history } = useUtils();

  useEffect(() => {
    const redirectRoute = controller.appRoute();
    history.push(redirectRoute);
  }, []);

  useEffect(() => {
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <>
      <Switch>
        <Route path="/app.html" component={Start} exact />
        <Route path="/import" component={Import} exact />
        <Route path="/remind" component={WelcomeWallet} exact />
        <Route path="/create/pass" component={CreatePass} exact />
        <Route
          path="/create/phrase/generated"
          component={CreatePhrase}
          exact
        />
        <Route
          path="/create/phrase/check"
          component={ConfirmPhrase}
          exact
        />
      </Switch>
    </>
  );
};
