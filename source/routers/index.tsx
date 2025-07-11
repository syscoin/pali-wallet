import React, { lazy, Suspense } from 'react';
import {
  Routes,
  Route,
  Navigate,
  useSearchParams,
  useNavigate,
} from 'react-router-dom';

import { AppLayout } from 'components/Layout/AppLayout';
import { WarningModal } from 'components/Modal';
import { useController } from 'hooks/useController';
import { useNavigationState } from 'hooks/useNavigationState';
import { useRouterLogic } from 'routers/useRouterLogic';

import { ProtectedRoute } from './ProtectedRoute';

// Component to handle external routing from query parameters
const ExternalQueryHandler = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasRedirectedRef = React.useRef(false);
  const { isUnlocked, isLoading } = useController();

  React.useEffect(() => {
    // Prevent double execution
    if (hasRedirectedRef.current) {
      return;
    }

    // Wait for auth check to complete
    if (isLoading) {
      return;
    }

    const route = searchParams.get('route');

    if (route) {
      // Mark that we've handled the redirect
      hasRedirectedRef.current = true;

      if (!isUnlocked) {
        // If not authenticated, redirect to auth flow and preserve the external route info
        const data = searchParams.get('data');
        const newSearchParams = new URLSearchParams();
        if (data) {
          newSearchParams.set('data', data);
        }
        newSearchParams.set('externalRoute', route);

        navigate(`/?${newSearchParams.toString()}`, { replace: true });
      } else {
        // If authenticated, redirect to the external route
        const routePath = `/external/${route}`;

        // Preserve the data parameter for the target route
        const data = searchParams.get('data');
        const newSearchParams = new URLSearchParams();
        if (data) {
          newSearchParams.set('data', data);
        }

        navigate(routePath + (data ? `?${newSearchParams.toString()}` : ''), {
          replace: true,
        });
      }
    }
  }, [navigate, searchParams, isUnlocked, isLoading]);

  return <div style={{ opacity: 0 }}>Loading...</div>;
};

// Navigation state restorer component
const NavigationRestorer = () => {
  const { restoreState } = useNavigationState();
  const { isLoading, isUnlocked } = useController();
  const hasAttemptedRestore = React.useRef(false);

  React.useEffect(() => {
    // Don't attempt restoration if already done
    if (hasAttemptedRestore.current) return;

    // Wait for auth state to be loaded
    if (isLoading) return;

    // Mark that we've attempted restoration
    hasAttemptedRestore.current = true;

    // If user is authenticated, attempt to restore navigation
    if (isUnlocked) {
      // Small delay to ensure all components are mounted and ready
      setTimeout(() => {
        restoreState();
      }, 100);
    }
  }, [restoreState, isLoading, isUnlocked]);

  return null;
};

// Lazy load route groups
const AuthRoutes = lazy(() => import('./routes/AuthRoutes'));

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

// External/dApp components
const ConnectWallet = lazy(() =>
  import('pages').then((m) => ({ default: m.ConnectWallet }))
);
const ChangeAccount = lazy(() =>
  import('pages').then((m) => ({ default: m.ChangeAccount }))
);
const ChangeConnectedAccount = lazy(() =>
  import('pages').then((m) => ({ default: m.ChangeConnectedAccount }))
);
const ExternalWatchAsset = lazy(() =>
  import('pages').then((m) => ({ default: m.ExternalWatchAsset }))
);
const CustomRPCExternal = lazy(() =>
  import('pages').then((m) => ({ default: m.CustomRPCExternal }))
);
const SwitchChain = lazy(() =>
  import('pages').then((m) => ({ default: m.SwitchChain }))
);
const SwitchNeworkUtxoEvm = lazy(() =>
  import('pages').then((m) => ({ default: m.SwitchNeworkUtxoEvm }))
);
const SendTransaction = lazy(() =>
  import('pages').then((m) => ({ default: m.SendTransaction }))
);
const SendNTokenTransaction = lazy(() =>
  import('pages').then((m) => ({ default: m.SendNTokenTransaction }))
);
const ApproveTransactionComponent = lazy(() =>
  import('pages').then((m) => ({ default: m.ApproveTransactionComponent }))
);
const SignAndSend = lazy(() =>
  import('pages').then((m) => ({ default: m.SignAndSend }))
);
const EthSign = lazy(() =>
  import('pages').then((m) => ({ default: m.EthSign }))
);
const EncryptPubKey = lazy(() =>
  import('pages').then((m) => ({ default: m.EncryptPubKey }))
);
const Decrypt = lazy(() =>
  import('pages').then((m) => ({ default: m.Decrypt }))
);
const Sign = lazy(() => import('pages').then((m) => ({ default: m.Sign })));

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
      <NavigationRestorer />
      <WarningModal
        show={showUtf8ErrorModal}
        title={t('settings.bgError')}
        description={t('settings.bgErrorMessage')}
        onClose={handleUtf8ErrorClose}
      />
      <WarningModal
        show={showModal}
        title={t('send.rpcError')}
        description={`${modalMessage}`}
        warningMessage={warningMessage}
        onClose={() => setShowModal(false)}
      />
      <Suspense
        fallback={
          // Minimal transparent fallback - AppLayout will handle the actual loading display
          <div style={{ opacity: 0 }}>Loading...</div>
        }
      >
        <Routes>
          {/* Auth Routes - No persistent layout */}
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

          {/* Handle external.html with query parameters */}
          <Route path="external.html" element={<ExternalQueryHandler />} />

          {/* Special route for switch-network that needs different handling */}
          <Route path="switch-network" element={<SwitchNetwork />} />

          {/* All protected routes wrapped in AppLayout for persistent header */}
          <Route element={<ProtectedRoute element={<AppLayout />} />}>
            {/* Home Routes */}
            <Route path="/home" element={<Home />} />
            <Route path="/home/details" element={<DetailsView />} />

            {/* Transaction Routes */}
            <Route path="/receive" element={<Receive />} />
            <Route path="/faucet" element={<Faucet />} />
            <Route path="/send/eth" element={<SendEth />} />
            <Route path="/send/sys" element={<SendSys />} />
            <Route path="/send/confirm" element={<SendConfirm />} />

            {/* Network Routes */}
            <Route path="/chain-fail-to-connect" element={<ChainErrorPage />} />
            <Route path="/tokens/add" element={<AddToken />} />

            {/* Settings Routes */}
            <Route path="/settings/about" element={<About />} />
            <Route path="/settings/remove-eth" element={<RemoveEth />} />
            <Route path="/settings/advanced" element={<Advanced />} />
            <Route path="/settings/languages" element={<Languages />} />
            <Route path="/settings/currency" element={<Currency />} />
            <Route path="/settings/forget-wallet" element={<ForgetWallet />} />
            <Route path="/settings/seed" element={<Phrase />} />
            <Route
              path="/settings/manage-accounts"
              element={<ManageAccounts />}
            />
            <Route path="/settings/edit-account" element={<EditAccount />} />

            {/* Account sub-routes */}
            <Route path="/settings/account/new" element={<CreateAccount />} />
            <Route
              path="/settings/account/import"
              element={<ImportAccount />}
            />
            <Route
              path="/settings/account/private-key"
              element={<PrivateKey />}
            />

            {/* Network sub-routes */}
            <Route
              path="/settings/networks/connected-sites"
              element={<ConnectedSites />}
            />
            <Route
              path="/settings/networks/custom-rpc"
              element={<CustomRPC />}
            />
            <Route path="/settings/networks/edit" element={<ManageNetwork />} />
            <Route
              path="/settings/networks/trusted-sites"
              element={<TrustedSites />}
            />

            {/* External/dApp Routes - also wrapped in AppLayout */}
            <Route path="/external">
              <Route path="import" element={<Import />} />
              <Route path="phrase" element={<SeedConfirm />} />
              <Route path="connect-wallet" element={<ConnectWallet />} />
              <Route path="change-account" element={<ChangeAccount />} />
              <Route
                path="change-active-connected-account"
                element={<ChangeConnectedAccount />}
              />
              <Route path="watch-asset" element={<ExternalWatchAsset />} />
              <Route path="switch-network" element={<SwitchNetwork />} />
              <Route path="add-EthChain" element={<CustomRPCExternal />} />
              <Route path="switch-EthChain" element={<SwitchChain />} />
              <Route path="switch-UtxoEvm" element={<SwitchNeworkUtxoEvm />} />
              <Route
                path="settings/account/hardware"
                element={<ConnectHardwareWallet />}
              />

              {/* External transaction routes */}
              <Route path="tx">
                <Route path="send/confirm" element={<SendConfirm />} />
                <Route path="send/ethTx" element={<SendTransaction />} />
                <Route
                  path="send/nTokenTx"
                  element={<SendNTokenTransaction />}
                />
                <Route
                  path="send/approve"
                  element={<ApproveTransactionComponent />}
                />
                <Route path="sign" element={<SignAndSend />} />
                <Route path="ethSign" element={<EthSign />} />
                <Route path="encryptKey" element={<EncryptPubKey />} />
                <Route path="decrypt" element={<Decrypt />} />
                <Route path="sign-psbt" element={<Sign />} />
              </Route>
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
