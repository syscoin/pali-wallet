import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import {
  Routes,
  Route,
  useLocation,
  useParams,
  Navigate,
} from 'react-router-dom';
import { browser } from 'webextension-polyfill-ts';

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
  Send,
  SendConfirm,
  Start,
  TrustedSites,
  AddToken,
  SeedConfirm,
  Phrase,
} from '../pages';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { ProtectedRoute } from './ProtectedRoute';

export const Router = () => {
  const params = useParams();
  const { wallet, appRoute, refresh } = getController();
  const { alert, navigate } = useUtils();
  const { pathname } = useLocation();
  const {
    vault: { accounts, encryptedMnemonic },
  } = useSelector((state: RootState) => state);

  const isUnlocked = wallet.isUnlocked() && encryptedMnemonic;

  useEffect(() => {
    if (isUnlocked) {
      window.addEventListener('mousemove', () => {
        browser.runtime.sendMessage({
          type: 'autolock',
          target: 'background',
        });
      });
    }
  }, [isUnlocked]);

  useEffect(() => {
    const canProceed = isUnlocked && accounts && encryptedMnemonic;

    if (canProceed) {
      navigate('/home');

      return;
    }

    const route = appRoute();
    if (route !== '/') navigate(route);
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked) refresh(true);
  }, [isUnlocked]);

  useEffect(() => {
    alert.removeAll();
    appRoute(pathname);
  }, [pathname]);

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

      <Route path="send" element={<ProtectedRoute element={<Send />} />} />
      <Route
        path="send/confirm"
        element={<ProtectedRoute element={<SendConfirm />} />}
      />
      <Route
        path="send/:address"
        element={
          <ProtectedRoute element={<Send initAddress={params.address} />} />
        }
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
