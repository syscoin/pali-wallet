import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { LoadingSpinner } from 'components/LoadingSpinner';
import { WarningModal } from 'components/Modal';
import { useRouterLogic } from 'routers/useRouterLogic';

import { ProtectedRoute } from './ProtectedRoute';

// Lazy load route groups
const AuthRoutes = lazy(() => import('./routes/AuthRoutes'));
const HomeRoutes = lazy(() => import('./routes/HomeRoutes'));
const SettingsRoutes = lazy(() => import('./routes/SettingsRoutes'));
const TransactionRoutes = lazy(() => import('./routes/TransactionRoutes'));
const NetworkRoutes = lazy(() => import('./routes/NetworkRoutes'));

// Lazy load components with proper imports
const About = lazy(() => import('pages').then((m) => ({ default: m.About })));
const ConnectedSites = lazy(() =>
  import('pages').then((m) => ({ default: m.ConnectedSites }))
);
const ConnectHardwareWallet = lazy(() =>
  import('pages').then((m) => ({ default: m.ConnectHardwareWallet }))
);
const CreateAccount = lazy(() =>
  import('pages').then((m) => ({ default: m.CreateAccount }))
);
const CreatePass = lazy(() =>
  import('pages').then((m) => ({ default: m.CreatePass }))
);
const Currency = lazy(() =>
  import('pages').then((m) => ({ default: m.Currency }))
);
const CustomRPC = lazy(() =>
  import('pages').then((m) => ({ default: m.CustomRPC }))
);
const ForgetWallet = lazy(() =>
  import('pages').then((m) => ({ default: m.ForgetWallet }))
);
const DetailsView = lazy(() =>
  import('pages').then((m) => ({ default: m.DetailsView }))
);
const ManageNetwork = lazy(() =>
  import('pages').then((m) => ({ default: m.ManageNetwork }))
);
const Home = lazy(() => import('pages').then((m) => ({ default: m.Home })));
const Import = lazy(() => import('pages').then((m) => ({ default: m.Import })));
const PrivateKey = lazy(() =>
  import('pages').then((m) => ({ default: m.PrivateKey }))
);
const Receive = lazy(() =>
  import('pages').then((m) => ({ default: m.Receive }))
);
const SendEth = lazy(() =>
  import('pages').then((m) => ({ default: m.SendEth }))
);
const SendSys = lazy(() =>
  import('pages').then((m) => ({ default: m.SendSys }))
);
const SendConfirm = lazy(() =>
  import('pages').then((m) => ({ default: m.SendConfirm }))
);
const Start = lazy(() => import('pages').then((m) => ({ default: m.Start })));
const TrustedSites = lazy(() =>
  import('pages').then((m) => ({ default: m.TrustedSites }))
);
const AddToken = lazy(() =>
  import('pages').then((m) => ({ default: m.AddToken }))
);
const SeedConfirm = lazy(() =>
  import('pages').then((m) => ({ default: m.SeedConfirm }))
);
const Phrase = lazy(() => import('pages').then((m) => ({ default: m.Phrase })));
const ImportAccount = lazy(() =>
  import('pages').then((m) => ({ default: m.ImportAccount }))
);
const RemoveEth = lazy(() =>
  import('pages').then((m) => ({ default: m.RemoveEth }))
);
const CreatePasswordImport = lazy(() =>
  import('pages').then((m) => ({ default: m.CreatePasswordImport }))
);
const ManageAccounts = lazy(() =>
  import('pages').then((m) => ({ default: m.ManageAccounts }))
);
const EditAccount = lazy(() =>
  import('pages').then((m) => ({ default: m.EditAccount }))
);
const Advanced = lazy(() =>
  import('pages').then((m) => ({ default: m.Advanced }))
);
const Languages = lazy(() =>
  import('pages').then((m) => ({ default: m.Languages }))
);
const ChainErrorPage = lazy(() =>
  import('pages/Chain/ChainErrorPage').then((m) => ({
    default: m.ChainErrorPage,
  }))
);
const Faucet = lazy(() =>
  import('pages/Faucet').then((m) => ({ default: m.Faucet }))
);
const SwitchNetwork = lazy(() =>
  import('pages/SwitchNetwork').then((m) => ({ default: m.SwitchNetwork }))
);

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
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          {/* Auth Routes */}
          <Route path="/" element={<AuthRoutes />}>
            <Route path="/" element={<Start />} />
            <Route path="create-password" element={<CreatePass />} />
            <Route
              path="create-password-import"
              element={<CreatePasswordImport />}
            />
            <Route path="import" element={<Import />} />
            <Route path="phrase" element={<SeedConfirm />} />
          </Route>

          {/* Home Routes */}
          <Route path="/home" element={<HomeRoutes />}>
            <Route index element={<ProtectedRoute element={<Home />} />} />
            <Route
              path="details"
              element={<ProtectedRoute element={<DetailsView />} />}
            />
          </Route>

          {/* Transaction Routes */}
          <Route path="/" element={<TransactionRoutes />}>
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
          </Route>

          {/* Network Routes */}
          <Route path="/" element={<NetworkRoutes />}>
            <Route path="switch-network" element={<SwitchNetwork />} />
            <Route
              path="chain-fail-to-connect"
              element={<ProtectedRoute element={<ChainErrorPage />} />}
            />
            <Route
              path="tokens/add"
              element={<ProtectedRoute element={<AddToken />} />}
            />
          </Route>

          {/* Settings Routes */}
          <Route path="settings" element={<SettingsRoutes />}>
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

          <Route
            path="app.html"
            element={<Navigate to={{ pathname: '/' }} />}
          />
        </Routes>
      </Suspense>
    </>
  );
};
