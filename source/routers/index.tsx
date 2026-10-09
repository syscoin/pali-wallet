import React, { lazy, Suspense } from 'react';
import {
  Routes,
  Route,
  Navigate,
  useSearchParams,
  useNavigate,
} from 'react-router-dom';

import { AppLayout } from 'components/Layout/AppLayout';
import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { WarningModal } from 'components/Modal';
import { useController } from 'hooks/useController';
import { useNavigationState } from 'hooks/useNavigationState';
import { OnboardingSecretsProvider } from 'hooks/useOnboardingSecrets';
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
    // Mark that we've handled the redirect
    hasRedirectedRef.current = true;
    if (route) {
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
        // Special handling for login route when already authenticated
        if (route === 'login') {
          window.close();
          return;
        }

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
  return <AppLoadingSkeleton />;
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

// Import each route directly: importing the pages barrel fetches every screen
// before the first route can render.
const About = lazy(() => import('pages/Settings/About'));
const ConnectedSites = lazy(() => import('pages/Settings/ConnectedSites'));
const ConnectHardwareWallet = lazy(
  () => import('pages/Settings/ConnectHardwareWallet')
);
const CreateAccount = lazy(() => import('pages/Settings/CreateAccount'));
const CreatePass = lazy(() =>
  import('pages/CreatePass/CreatePass').then((m) => ({ default: m.CreatePass }))
);
const Currency = lazy(() => import('pages/Settings/Currency'));
const CustomRPC = lazy(() => import('pages/Settings/CustomRPC'));
const ForgetWallet = lazy(() => import('pages/Settings/ForgetWallet'));
const DetailsView = lazy(() =>
  import('pages/Home/Panel/components/Details').then((m) => ({
    default: m.DetailsView,
  }))
);
const ManageNetwork = lazy(() => import('pages/Settings/ManageNetwork'));
const Home = lazy(() =>
  import('pages/Home/Home').then((m) => ({ default: m.Home }))
);
const Import = lazy(() =>
  import('pages/Import').then((m) => ({ default: m.Import }))
);
const PrivateKey = lazy(() => import('pages/Settings/PrivateKey'));
const Receive = lazy(() =>
  import('pages/Receive/Receive').then((m) => ({ default: m.Receive }))
);
const SendEth = lazy(() =>
  import('pages/Send/SendEth').then((m) => ({ default: m.SendEth }))
);
const SendSys = lazy(() =>
  import('pages/Send/SendSys').then((m) => ({ default: m.SendSys }))
);
const SendConfirm = lazy(() =>
  import('pages/Send/Confirm').then((m) => ({ default: m.SendConfirm }))
);
const Start = lazy(() =>
  import('pages/Start/Start').then((m) => ({ default: m.Start }))
);
const TrustedSites = lazy(() => import('pages/Settings/TrustedSites'));
const AddToken = lazy(() =>
  import('pages/Tokens/AddToken').then((m) => ({ default: m.AddToken }))
);
const SeedConfirm = lazy(() =>
  import('pages/SeedConfirm').then((m) => ({ default: m.SeedConfirm }))
);
const Phrase = lazy(() => import('pages/Settings/Phrase'));
const ImportAccount = lazy(() => import('pages/Settings/ImportAccount'));
const RemoveEth = lazy(() => import('pages/Settings/RemoveEth'));
const CreatePasswordImport = lazy(() =>
  import('pages/Import/CreatePass').then((m) => ({
    default: m.CreatePasswordImport,
  }))
);
const ManageAccounts = lazy(() => import('pages/Settings/ManageAccounts'));
const SmartAccountPolicy = lazy(
  () => import('pages/Settings/SmartAccountPolicy')
);
const SmartAccountHub = lazy(() => import('pages/SmartAccount/Hub'));
const EditAccount = lazy(() => import('pages/Settings/EditAccount'));
const Advanced = lazy(() => import('pages/Settings/Advanced'));
const Languages = lazy(() => import('pages/Settings/Languages'));
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
  import('pages/Connections/ConnectWallet').then((m) => ({
    default: m.ConnectWallet,
  }))
);
const ChangeAccount = lazy(() =>
  import('pages/Connections/ChangeAccount').then((m) => ({
    default: m.ChangeAccount,
  }))
);
const ChangeConnectedAccount = lazy(() =>
  import('pages/Connections/ChangeConnectedAccount').then((m) => ({
    default: m.ChangeConnectedAccount,
  }))
);
const PrepareSmartAccount = lazy(() =>
  import('pages/Connections/PrepareSmartAccount').then((m) => ({
    default: m.PrepareSmartAccount,
  }))
);
const SmartAccountModuleConsent = lazy(() =>
  import('pages/Connections/SmartAccountModuleConsent').then((m) => ({
    default: m.SmartAccountModuleConsent,
  }))
);
const ExternalWatchAsset = lazy(
  () => import('pages/Settings/ExternalWatchAsset')
);
const CustomRPCExternal = lazy(() => import('pages/Settings/ExternalAddRPC'));
const SwitchChain = lazy(() => import('pages/Settings/SwitchEthereumChain'));
const SpamWarning = lazy(() =>
  import('pages/External/SpamWarning').then((m) => ({ default: m.SpamWarning }))
);
const SwitchNeworkUtxoEvm = lazy(
  () => import('pages/Settings/SwitchNetworkUtxoEvm')
);
const SendTransaction = lazy(() =>
  import('pages/Send/SendTransaction').then((m) => ({
    default: m.SendTransaction,
  }))
);
const SendCalls = lazy(() =>
  import('pages/Send/SendCalls').then((m) => ({ default: m.SendCalls }))
);
const CallsStatus = lazy(() =>
  import('pages/Send/CallsStatus').then((m) => ({ default: m.CallsStatus }))
);
const SignAndSend = lazy(() =>
  import('pages/Transactions').then((m) => ({ default: m.SignAndSend }))
);
const EthSign = lazy(() => import('pages/Transactions/SignEth'));
const EncryptPubKey = lazy(() => import('pages/Transactions/EncryptPubKey'));
const Decrypt = lazy(() => import('pages/Transactions/Decrypt'));
const Sign = lazy(() =>
  import('pages/Transactions').then((m) => ({ default: m.Sign }))
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
    <OnboardingSecretsProvider>
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
          // Branded skeleton matching the HTML loader - avoids a blank popup
          // while lazy route chunks load
          <AppLoadingSkeleton />
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

          {/* Spam filter routes - rendered without AppLayout header */}
          <Route path="/external/spam-warning" element={<SpamWarning />} />

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
            <Route path="/home/smart-account" element={<SmartAccountHub />} />
            <Route
              path="/settings/account/smart-account-policy"
              element={<SmartAccountPolicy />}
            />
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
              <Route path="login" element={<Start isExternal={true} />} />
              <Route path="connect-wallet" element={<ConnectWallet />} />
              <Route path="change-account" element={<ChangeAccount />} />
              <Route path="smart-account" element={<PrepareSmartAccount />} />
              <Route
                path="smart-account-modules"
                element={<SmartAccountModuleConsent />}
              />
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
                <Route path="send/calls" element={<SendCalls />} />
                <Route path="calls-status" element={<CallsStatus />} />
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
    </OnboardingSecretsProvider>
  );
};
