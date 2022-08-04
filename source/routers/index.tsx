import React, { useEffect } from 'react';
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
  ConfirmPhrase,
  ConnectedSites,
  ConnectHardwareWallet,
  CreateAccount,
  CreatePass,
  CreatePhrase,
  Currency,
  CustomRPC,
  CustomToken,
  ForgetWallet,
  DetailsView,
  ManageNetwork,
  Home,
  Import,
  ImportToken,
  Phrase,
  PrivateKey,
  Receive,
  Send,
  SendConfirm,
  Start,
  TrustedSites,
} from '../pages';
import { useUtils, useStore } from 'hooks/index';
import { getController } from 'utils/browser';

import { ProtectedRoute } from './ProtectedRoute';

export const Router = () => {
  const params = useParams();
  const { wallet, appRoute } = getController();

  const { alert, navigate, handleRefresh } = useUtils();
  const { accounts, activeAccount } = useStore();
  const { pathname } = useLocation();

  const isUnlocked = wallet.isUnlocked() && activeAccount.address !== '';

  useEffect(() => {
    if (isUnlocked) {
      window.addEventListener('mousemove', () => {
        browser.runtime.sendMessage({
          type: 'SET_MOUSE_MOVE',
          target: 'background',
        });
      });
    }
  }, [isUnlocked]);

  useEffect(() => {
    const canProceed = isUnlocked && accounts && activeAccount.address;
    if (canProceed) {
      navigate('/home');

      return;
    }

    const route = appRoute();
    if (route !== '/') navigate(route);
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked) {
      handleRefresh(true);
    }
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
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />

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
      <Route path="tokens/add">
        <Route
          path="import"
          element={<ProtectedRoute element={<ImportToken />} />}
        />
        <Route
          path="custom"
          element={<ProtectedRoute element={<CustomToken />} />}
        />
      </Route>

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
        <Route
          path="phrase"
          element={<ProtectedRoute element={<Phrase />} />}
        />

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
