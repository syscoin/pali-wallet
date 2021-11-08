import React, { useEffect } from 'react';
import { Switch, Route, useLocation, useHistory } from 'react-router-dom';
import Start from 'containers/unauth/Start';
import Remind from 'containers/unauth/Remind';
import CreatePass from 'containers/unauth/CreatePass';
import { useTransition, animated } from 'react-spring';
import {
  CreatePhrase,
  ConfirmPhrase,
} from 'containers/unauth/Phrase';
import Import from 'containers/common/Import';
import { useController } from 'hooks/index';

const UnAuth = () => {
  const location = useLocation();
  const history = useHistory();
  const controller = useController();
  // const transitions = useTransition(location, (locat) => locat.pathname, {
  //   initial: { opacity: 1 },
  //   from: { opacity: 0 },
  //   enter: { opacity: 1 },
  //   leave: { opacity: 0 },
  //   config: { duration: 20 },
  // });

  useEffect(() => {
    const redirectRoute = controller.appRoute();
    history.push(redirectRoute);
  }, []);

  useEffect(() => {
    controller.appRoute(location.pathname);
  }, [location]);

  return (
    <>
      <div className="absolute w-full h-full">
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
      </div>
    </>
  );
};

export default UnAuth;
