import React, { FC, useEffect } from 'react';
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

const App: FC = () => {
  useEffect(() => {
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

  // other logic
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
