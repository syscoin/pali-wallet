import React, { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Import } from 'containers/common/Import';
import { useController, useUtils } from 'hooks/index';
import {
  CreatePhrase,
  ConfirmPhrase,
  Start,
  CreatePass,
} from 'containers/unauth/index';

export const UnAuthRouter = () => {
  const location = useLocation();
  const controller = useController();
  const { navigate } = useUtils();

  useEffect(() => {
    const redirectRoute = controller.appRoute();
    navigate(redirectRoute);
  }, [controller]);

  useEffect(() => {
    controller.appRoute(location.pathname);
  }, [location, controller]);

  return (
    <>
      <Routes>
        <Route path="/app.html" element={<Start />} />
        <Route path="/import" element={<Import />} />
        <Route path="/create/pass" element={<CreatePass />} />
        <Route path="/create/phrase/generated" element={<CreatePhrase />} />
        <Route path="/create/phrase/check" element={<ConfirmPhrase />} />
      </Routes>
    </>
  );
};
