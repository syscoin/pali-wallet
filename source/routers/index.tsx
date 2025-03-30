import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import {
  About,
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
  CreatePasswordImport,
  ManageAccounts,
  EditAccount,
  Advanced,
  Languages,
} from '../pages';
import { WarningModal } from 'components/Modal';
import { ChainErrorPage } from 'pages/Chain';
import { Faucet } from 'pages/Faucet';
import { SwitchNetwork } from 'pages/SwitchNetwork';
import { useRouterLogic } from 'routers/useRouterLogic';

import { ProtectedRoute } from './ProtectedRoute';
export const Router = () => {
  const {
    showModal,
    setShowModal,
    modalMessage,
    showUtf8ErrorModal,
    t,
    handleUtf8ErrorClose,
    warningMessage,
  } = useRouterLogic();

  return (
    <>
      <WarningModal
        show={showUtf8ErrorModal}
        title={t('settings.bgError')}
        description={t('settings.bgErrorMessage')}
        onClose={handleUtf8ErrorClose}
      />
      <WarningModal
        show={showModal}
        title="RPC Error"
        description={`${modalMessage}`}
        warningMessage={warningMessage}
        onClose={() => setShowModal(false)}
      />
      <Routes>
        <Route path="/" element={<Start />} />
        <Route path="create-password" element={<CreatePass />} />
        <Route
          path="create-password-import"
          element={<CreatePasswordImport />}
        />
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
          path="/faucet"
          element={<ProtectedRoute element={<Faucet />} />}
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
        <Route path="switch-network" element={<SwitchNetwork />} />
        <Route
          path="chain-fail-to-connect"
          element={<ProtectedRoute element={<ChainErrorPage />} />}
        />
        <Route
          path="tokens/add"
          element={<ProtectedRoute element={<AddToken />} />}
        />
        <Route path="settings">
          <Route
            path="about"
            element={<ProtectedRoute element={<About />} />}
          />
          <Route
            path="remove-eth"
            element={<ProtectedRoute element={<RemoveEth />} />}
          />
          <Route
            path="advanced"
            element={<ProtectedRoute element={<Advanced />} />}
          />
          <Route
            path="languages"
            element={<ProtectedRoute element={<Languages />} />}
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
            path="seed"
            element={<ProtectedRoute element={<Phrase />} />}
          />
          <Route
            path="manage-accounts"
            element={<ProtectedRoute element={<ManageAccounts />} />}
          />
          <Route
            path="edit-account"
            element={<ProtectedRoute element={<EditAccount />} />}
          />
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
    </>
  );
};
