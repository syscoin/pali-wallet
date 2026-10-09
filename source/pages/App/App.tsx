import React, { FC, useEffect, useState } from 'react';
import { HashRouter, useNavigate } from 'react-router-dom';

import { Container } from 'components/index';
import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import WalletErrorBoundary from 'components/WalletErrorBoundary/WalletErrorBoundary';
import { Router } from 'routers/index';
import { hasExternalWalletPage } from 'utils/extensionContexts';
import {
  startupFeedbackDelay,
  WALLET_FEEDBACK_TIMEOUT_MS,
} from 'utils/requestWalletState';

// Wrapper component to provide navigate function to error boundary
const AppWithErrorBoundary: FC = () => {
  const navigate = useNavigate();

  return (
    <WalletErrorBoundary navigate={navigate}>
      <div className="w-full min-w-popup h-full min-h-popup">
        <Router />
      </div>
    </WalletErrorBoundary>
  );
};

// Main app component that establishes port connection only when no external tabs
const MainApp: FC = () => {
  useEffect(() => {
    // Establish port connection for main app functionality
    const port = chrome.runtime.connect({ name: 'popup-connection' });
    console.log('[MainApp] 🔌 Connected to background script via port');

    const messageListener = ({ type }) => {
      if (type === 'logout') {
        window.location.hash = '';
        window.location.replace('/app.html#');
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      port.disconnect();
      console.log('[MainApp] 🔌 Disconnected from background script');
    };
  }, []);

  return (
    <section className="mx-auto h-full min-w-popup min-h-popup md:max-w-2xl">
      <Container>
        <HashRouter>
          <AppWithErrorBoundary />
        </HashRouter>
      </Container>
    </section>
  );
};

// Component to show when external window is open
const ExternalActiveMessage: FC = () => (
  <div className="flex flex-col items-center bg-no-repeat bg-[url('../../../source/assets/all_assets/GET_STARTED2.webp')] justify-center min-w-full h-screen login-animated-bg">
    {/* Subtle twinkling particles */}
    <div className="particle-1"></div>
    <div className="particle-2"></div>
    <div className="particle-3"></div>
    <div className="particle-4"></div>
    <div className="particle-5"></div>
    <div className="particle-6"></div>

    <div className="relative z-10 flex flex-col items-center text-center max-w-md mx-auto px-6">
      <div className="flex flex-row gap-3 mb-8">
        <h1 className="text-[#4DA2CF] text-justify font-poppins text-[37.87px] font-bold leading-[37.87px] tracking-[0.379px]">
          Pali
        </h1>
        <h1 className="text-[#4DA2CF] font-poppins text-[37.87px] font-light leading-[37.87px] tracking-[0.379px]">
          Wallet
        </h1>
      </div>

      <div className="bg-bkg-4/80 backdrop-blur-sm rounded-2xl p-6 border border-brand-royalblue/20">
        <div className="w-16 h-16 mx-auto mb-4 bg-warning-error/20 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-warning-error"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h2 className="text-white text-lg font-medium mb-3">
          Pali is Currently Active
        </h2>

        <p className="text-brand-graylight text-sm leading-relaxed">
          Pali Wallet is currently being used for a DApp connection. Please
          complete or close the DApp interaction before opening the main wallet
          interface.
        </p>
      </div>
    </div>
  </div>
);

const App: FC = () => {
  const [isExternalActive, setIsExternalActive] = useState(false);
  const [isCheckingExternal, setIsCheckingExternal] = useState(true);

  const [externalCheckFailed, setExternalCheckFailed] = useState(false);
  const [externalCheckSlow, setExternalCheckSlow] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let abortController: AbortController;
    let feedbackTimer: ReturnType<typeof setTimeout>;
    const checkForExternalTabs = async () => {
      const isInitialCheck = generation === 0 && checkAttempt === 0;
      const current = ++generation;
      abortController?.abort();
      clearTimeout(feedbackTimer);
      abortController = new AbortController();
      setIsCheckingExternal(true);
      setExternalCheckFailed(false);
      setExternalCheckSlow(false);
      feedbackTimer = setTimeout(
        () => {
          if (active && current === generation) setExternalCheckSlow(true);
        },
        isInitialCheck ? startupFeedbackDelay() : WALLET_FEEDBACK_TIMEOUT_MS
      );
      try {
        const hasExternal = await hasExternalWalletPage(
          undefined,
          abortController.signal
        );
        if (!active || current !== generation) return;
        setIsExternalActive(hasExternal);
      } catch {
        if (!active || current !== generation) return;
        setExternalCheckFailed(true);
      } finally {
        if (active && current === generation) {
          clearTimeout(feedbackTimer);
          setIsCheckingExternal(false);
          setExternalCheckSlow(false);
        }
      }
    };
    void checkForExternalTabs();
    const handleStorageChange = (changes: any) => {
      if (changes['pali-popup-open'] || changes['pali-popup-timestamp']) {
        void checkForExternalTabs();
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      active = false;
      abortController?.abort();
      clearTimeout(feedbackTimer);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [checkAttempt]);

  if (externalCheckFailed || externalCheckSlow) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center text-white">
        <p role="status" className="mb-4">
          Wallet windows are taking longer to respond. Try checking again.
        </p>
        <button
          type="button"
          className="rounded-lg bg-[#4DA2CF] px-5 py-3 font-medium text-[#061120]"
          onClick={() => setCheckAttempt((attempt) => attempt + 1)}
        >
          Retry window check
        </button>
      </div>
    );
  }

  // Show branded skeleton while checking (matches the HTML loader)
  if (isCheckingExternal) {
    return (
      <section className="mx-auto h-full min-w-popup min-h-popup md:max-w-2xl">
        <Container>
          <AppLoadingSkeleton />
        </Container>
      </section>
    );
  }

  // Show external active message if any external tab/window is open
  if (isExternalActive) {
    return <ExternalActiveMessage />;
  }

  // Normal app behavior - establish port connection only when main app is active
  return <MainApp />;
};

export default App;
