import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';

import {
  About,
  AutoLock,
  ConnectedSites,
  ConnectHardwareWallet,
  CreateAccount,
  CreatePass,
  Currency,
  CustomRPC,
  ForgetWallet,
  DetailsView,
  ManageNetwork,
  Home,
  Import,
  PrivateKey,
  Receive,
  SendEth,
  SendSys,
  SendConfirm,
  Start,
  TrustedSites,
  AddToken,
  SeedConfirm,
  Phrase,
  ImportAccount,
  RemoveEth,
} from '../pages';
import { useUtils } from 'hooks/index';
import { inactivityTime } from 'scripts/Background';
import { injectScriptFile } from 'scripts/ContentScript';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { ProtectedRoute } from './ProtectedRoute';
export const Router = () => {
  const { wallet, appRoute } = getController();
  const { alert, navigate } = useUtils();
  const { pathname } = useLocation();
  const { isTimerEnabled } = useSelector((state: RootState) => state.vault);
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const isUnlocked = wallet.isUnlocked();

  useEffect(() => {
    const canProceed = isUnlocked && accounts;

    if (canProceed) {
      navigate('/home');

      return;
    }

    const route = appRoute();
    if (route !== '/') navigate(route);
  }, [isUnlocked]);

  useEffect(() => {
    if (isTimerEnabled) inactivityTime();
  }, []);

  useEffect(() => {
    alert.removeAll();
    appRoute(pathname);
  }, [pathname]);

  useEffect(() => {
    injectScriptFile('https://connect.trezor.io/9/trezor-connect.js', 'trezor');
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Start />} />

      <Route path="create-password" element={<CreatePass />} />
      <Route path="import" element={<Import />} />
      <Route path="phrase" element={<SeedConfirm />} />

      <Route path="home" element={<ProtectedRoute element={<Home />} />} />
      <Route
        path="home/details"
        element={<ProtectedRoute element={<DetailsView />} />}
      />

      <Route
        path="/receive"
        element={<ProtectedRoute element={<Receive />} />}
      />

      <Route
        path="send/eth"
        element={<ProtectedRoute element={<SendEth />} />}
      />

      <Route
        path="send/sys"
        element={<ProtectedRoute element={<SendSys />} />}
      />
      <Route
        path="send/confirm"
        element={<ProtectedRoute element={<SendConfirm />} />}
      />
      <Route
        path="send/edit/gas"
        element={<ProtectedRoute element={<SendConfirm />} />}
      />

      {/* /tokens/add */}
      <Route
        path="tokens/add"
        element={<ProtectedRoute element={<AddToken />} />}
      />

      {/* /settings */}
      <Route path="settings">
        <Route path="about" element={<ProtectedRoute element={<About />} />} />
        <Route
          path="autolock"
          element={<ProtectedRoute element={<AutoLock />} />}
        />
        <Route
          path="remove-eth"
          element={<ProtectedRoute element={<RemoveEth />} />}
        />
        <Route
          path="currency"
          element={<ProtectedRoute element={<Currency />} />}
        />
        <Route
          path="forget-wallet"
          element={<ProtectedRoute element={<ForgetWallet />} />}
        />
        <Route path="seed" element={<ProtectedRoute element={<Phrase />} />} />

        {/* /settings/account */}
        <Route path="account">
          <Route
            path="hardware"
            element={<ProtectedRoute element={<ConnectHardwareWallet />} />}
          />
          <Route
            path="new"
            element={<ProtectedRoute element={<CreateAccount />} />}
          />
          <Route
            path="import"
            element={<ProtectedRoute element={<ImportAccount />} />}
          />

          <Route
            path="private-key"
            element={<ProtectedRoute element={<PrivateKey />} />}
          />
        </Route>

        {/* /settings/networks */}
        <Route path="networks">
          <Route
            path="connected-sites"
            element={<ProtectedRoute element={<ConnectedSites />} />}
          />
          <Route
            path="custom-rpc"
            element={<ProtectedRoute element={<CustomRPC />} />}
          />
          <Route
            path="edit"
            element={<ProtectedRoute element={<ManageNetwork />} />}
          />
          <Route
            path="trusted-sites"
            element={<ProtectedRoute element={<TrustedSites />} />}
          />
        </Route>
      </Route>

      <Route path="app.html" element={<Navigate to={{ pathname: '/' }} />} />
    </Routes>
  );
};
