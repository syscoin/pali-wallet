import React, { useEffect } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useStore, useUtils } from 'hooks/index';
import { getController } from 'utils/browser';
import { browser } from 'webextension-polyfill-ts';
import { CustomToken, ImportToken } from 'pages/Tokens';

import {
  About,
  AutoLock,
  ConfirmPhrase,
  ConnectedAccounts,
  ConnectedSites,
  ConnectHardwareWallet,
  ConnectWallet,
  Create,
  CreateAccount,
  CreateAndIssueNFT,
  CreateAndIssueNFTConfirm,
  CreatePass,
  CreatePhrase,
  CreateTokenConfirm,
  Currency,
  CustomRPC,
  ForgetWallet,
  DetailsView,
  ManageNetwork,
  Home,
  Import,
  MintNFT,
  MintNFTConfirm,
  MintToken,
  MintTokenConfirm,
  Phrase,
  PrivateKey,
  Receive,
  Send,
  SendConfirm,
  SignAndSend,
  SignPSBT,
  Start,
  TransferOwnership,
  TransferOwnershipConfirm,
  TrustedSites,
  UpdateAsset,
  UpdateAssetConfirm,
} from '../pages';

import { ProtectedRoute } from './ProtectedRoute';

export const Router = () => {
  const location = useLocation();
  const controller = getController();

  const { accounts, activeAccount } = useStore();
  const { alert, navigate, handleRefresh } = useUtils();

  const isUnlocked =
    controller.wallet.isUnlocked() && activeAccount.address !== '';

  useEffect(() => {
    if (isUnlocked) {
      window.addEventListener('mousemove', () => {
        browser.runtime.sendMessage({
          type: 'SET_MOUSE_MOVE',
          target: 'background',
        });
      });
    }
  }, [isUnlocked, browser.runtime]);

  useEffect(() => {
    const route = controller.appRoute();

    if (isUnlocked && accounts && activeAccount.address) {
      navigate('/home');
    }

    if (route !== '/') navigate(route);
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked) {
      handleRefresh(true);
      console.log(
        'refreshing',
        controller.wallet.isUnlocked(),
        accounts,
        activeAccount
      );
    }
  }, [isUnlocked]);

  useEffect(() => {
    alert.removeAll();
    controller.appRoute(location.pathname);
  }, [location, isUnlocked]);

  return (
    <Routes>
      <Route path="/" element={<Start />} />
      <Route path="create-password" element={<CreatePass />} />
      <Route
        path="connect-wallet"
        element={<ProtectedRoute element={<ConnectWallet />} />}
      />
      <Route
        path="connected-accounts"
        element={<ProtectedRoute element={<ConnectedAccounts />} />}
      />
      <Route path="home" element={<ProtectedRoute element={<Home />} />} />
      <Route
        path="home/tx-details"
        element={<ProtectedRoute element={<DetailsView />} />}
      />
      <Route path="import" element={<Import />} />
      <Route path="phrase/create" element={<CreatePhrase />} />
      <Route path="phrase/confirm" element={<ConfirmPhrase />} />
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
        path="import-token"
        element={<ProtectedRoute element={<ImportToken />} />}
      />
      <Route
        path="custom-token"
        element={<ProtectedRoute element={<CustomToken />} />}
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
      {/* /tx */}
      <Route path="tx">
        <Route
          path="create"
          element={<ProtectedRoute element={<Create />} />}
        />
        <Route
          path="create/confirm"
          element={<ProtectedRoute element={<CreateTokenConfirm />} />}
        />
        <Route
          path="sign"
          element={<ProtectedRoute element={<SignAndSend />} />}
        />
        <Route
          path="sign-psbt"
          element={<ProtectedRoute element={<SignPSBT />} />}
        />
        {/* /tx/asset */}
        <Route path="asset">
          <Route
            path="issue"
            element={<ProtectedRoute element={<MintToken />} />}
          />
          <Route
            path="issue/confirm"
            element={<ProtectedRoute element={<MintTokenConfirm />} />}
          />
          <Route
            path="transfer"
            element={<ProtectedRoute element={<TransferOwnership />} />}
          />
          <Route
            path="transfer/confirm"
            element={<ProtectedRoute element={<TransferOwnershipConfirm />} />}
          />
          <Route
            path="update"
            element={<ProtectedRoute element={<UpdateAsset />} />}
          />
          <Route
            path="update/confirm"
            element={<ProtectedRoute element={<UpdateAssetConfirm />} />}
          />
          {/* /tx/asset/nft */}
          <Route path="nft">
            <Route
              path="issue"
              element={<ProtectedRoute element={<CreateAndIssueNFT />} />}
            />
            <Route
              path="issue/confirm"
              element={
                <ProtectedRoute element={<CreateAndIssueNFTConfirm />} />
              }
            />
            <Route
              path="mint"
              element={<ProtectedRoute element={<MintNFT />} />}
            />
            <Route
              path="mint/confirm"
              element={<ProtectedRoute element={<MintNFTConfirm />} />}
            />
          </Route>
        </Route>
      </Route>
      <Route path="app.html" element={<Navigate to={{ pathname: '/' }} />} />
    </Routes>
  );
};
