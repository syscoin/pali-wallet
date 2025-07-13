import React, { FC, useEffect, useState } from 'react';
import { HashRouter, useNavigate } from 'react-router-dom';

import { Container } from 'components/index';
import WalletErrorBoundary from 'components/WalletErrorBoundary/WalletErrorBoundary';
import { Router } from 'routers/index';

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
  <div className="flex flex-col items-center bg-no-repeat bg-[url('../../../source/assets/all_assets/GET_STARTED2.png')] justify-center min-w-full h-screen login-animated-bg">
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

  useEffect(() => {
    // Check for any extension tabs/windows using storage + context detection
    const checkForExternalTabs = async () => {
      try {
        // First check storage flags for immediate response
        chrome.storage.local.get(
          ['pali-popup-open', 'pali-popup-timestamp'],
          (result) => {
            const popupOpen = !!result['pali-popup-open'];
            const timestamp = result['pali-popup-timestamp'];
            const now = Date.now();

            if (popupOpen && timestamp) {
              // Check if timestamp is stale (older than 5 minutes)
              const STALE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

              if (now - timestamp > STALE_TIMEOUT) {
                // Stale flag - clear it and fall back to context check
                chrome.storage.local.remove([
                  'pali-popup-open',
                  'pali-popup-timestamp',
                ]);
              } else {
                // Valid recent flag - external popup is active
                setIsExternalActive(true);
                setIsCheckingExternal(false);
                return;
              }
            }

            // If no storage flag or stale flag was cleared, check contexts as fallback
            if (
              'getContexts' in chrome.runtime &&
              typeof chrome.runtime.getContexts === 'function'
            ) {
              (chrome.runtime as any).getContexts({}, (contexts: any[]) => {
                const ourExtensionOrigin = `chrome-extension://${chrome.runtime.id}`;

                // Check for any TAB context from our extension
                const hasExternalTab = contexts.some((ctx) => {
                  const isExtensionTab =
                    ctx.contextType === 'TAB' &&
                    ctx.documentOrigin === ourExtensionOrigin;
                  return isExtensionTab;
                });

                setIsExternalActive(hasExternalTab);
                setIsCheckingExternal(false);
              });
            } else {
              setIsExternalActive(false);
              setIsCheckingExternal(false);
            }
          }
        );
      } catch (error) {
        console.warn('[App] Could not check for external tabs:', error);
        setIsExternalActive(false);
        setIsCheckingExternal(false);
      }
    };

    checkForExternalTabs();

    // Listen for storage changes for external state
    const handleStorageChange = async (changes: any) => {
      if (changes['pali-popup-open'] || changes['pali-popup-timestamp']) {
        try {
          // Re-run the external tab check when storage changes
          checkForExternalTabs();
        } catch (error) {
          console.warn(
            '[App] Error checking external tabs on storage change:',
            error
          );
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    // Skip ALL background connections when external tabs are active
    // This prevents any interference with external popups

    // Cleanup: remove listeners when the component unmounts
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Show loading while checking
  if (isCheckingExternal) {
    return (
      <section className="mx-auto h-full min-w-popup min-h-popup md:max-w-2xl">
        <Container>
          <div style={{ opacity: 0 }}>Loading...</div>
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
