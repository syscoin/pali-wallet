import React, { useEffect } from 'react';
import { Switch, Route, useLocation } from 'react-router-dom';
import Start from 'containers/unauth/Start';
import Remind from 'containers/unauth/Remind';
import CreatePass from 'containers/unauth/CreatePass';
import Import from 'containers/common/Import';
import { useController, useUtils } from 'hooks/index';
import { CreatePhrase, ConfirmPhrase } from 'containers/unauth/Phrase';

const UnAuth = () => {
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
        <Route path="/remind" component={Remind} exact />
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

export default UnAuth;
