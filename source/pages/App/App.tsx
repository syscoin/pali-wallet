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

// Component to show when hardware wallet page is already open
const HardwareWalletConflictMessage: FC = () => {
  const handleCloseCurrentWindow = () => {
    window.close();
  };

  return (
    <div className="w-full min-w-popup h-full min-h-popup bg-brand-blue600 flex items-center justify-center p-6">
      <div className="text-center text-white max-w-sm">
        <div className="w-16 h-16 mx-auto mb-4 p-4 rounded-full bg-yellow-500/20">
          <svg
            className="w-8 h-8 text-yellow-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-medium mb-2">
          Hardware Wallet Setup In Progress
        </h2>
        <p className="text-sm text-brand-gray200 mb-6">
          You already have a hardware wallet setup window open. Please use that
          window to connect your hardware wallet.
        </p>
        <button
          onClick={handleCloseCurrentWindow}
          className="bg-white text-brand-blue600 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors"
        >
          Close This Window
        </button>
      </div>
    </div>
  );
};

const App: FC = () => {
  const [isHardwareWalletPageOpen, setIsHardwareWalletPageOpen] =
    useState(false);
  const [isCheckingHardwareWallet, setIsCheckingHardwareWallet] =
    useState(true);

  useEffect(() => {
    // Check if hardware wallet page is already open
    const checkForHardwareWalletPage = async () => {
      try {
        // Check if we ARE the hardware wallet page first
        const isCurrentPageHardwareWallet = window.location.hash.includes(
          '/settings/account/hardware'
        );

        if (isCurrentPageHardwareWallet) {
          // If we ARE the hardware wallet page, don't check for other tabs
          setIsHardwareWalletPageOpen(false);
          console.log(
            '[App] Current page IS hardware wallet page, skipping tab check'
          );
        } else {
          // Only check for other tabs if we're NOT the hardware wallet page
          const tabs = await chrome.tabs.query({});
          const hasHardwareWalletTab = tabs.some((tab) =>
            tab.url?.includes('/settings/account/hardware')
          );

          setIsHardwareWalletPageOpen(hasHardwareWalletTab);
          console.log('[App] Hardware wallet page check:', {
            hasHardwareWalletTab,
          });
        }
      } catch (error) {
        console.warn('[App] Could not check for hardware wallet page:', error);
        setIsHardwareWalletPageOpen(false);
      } finally {
        setIsCheckingHardwareWallet(false);
      }
    };

    checkForHardwareWalletPage();

    // 🚀 Establish port connection to background script for popup close detection
    const port = chrome.runtime.connect({ name: 'popup-connection' });
    console.log('[App] 🔌 Connected to background script via port');

    const messageListener = ({ type }) => {
      if (type === 'logout') {
        // Navigate to the home page after logout
        window.location.hash = '';
        window.location.replace('/app.html#');
      }
    };

    // Add the listener when the component mounts
    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup: remove listeners and disconnect port when the component unmounts
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      port.disconnect();
      console.log('[App] 🔌 Disconnected from background script');
    };
  }, []);

  // Show loading while checking
  if (isCheckingHardwareWallet) {
    return (
      <section className="mx-auto h-full min-w-popup min-h-popup md:max-w-2xl">
        <Container>
          <div style={{ opacity: 0 }}>Loading...</div>
        </Container>
      </section>
    );
  }

  // Show conflict message if hardware wallet page is already open
  if (isHardwareWalletPageOpen) {
    return (
      <section className="mx-auto h-full min-w-popup min-h-popup md:max-w-2xl">
        <Container>
          <HardwareWalletConflictMessage />
        </Container>
      </section>
    );
  }

  // Normal app behavior
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

export default App;
