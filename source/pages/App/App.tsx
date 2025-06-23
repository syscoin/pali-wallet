import React, { FC, useEffect } from 'react';
import { HashRouter, useNavigate } from 'react-router-dom';

import { Container } from 'components/index';
import WalletErrorBoundary from 'components/WalletErrorBoundary/WalletErrorBoundary';
import { Router } from 'routers/index';
import vaultCache from 'state/vaultCache';

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
    // Signal that the React app is ready after mounting
    const timer = setTimeout(() => {
      console.log('[App] Dispatching pali-app-ready event');
      window.dispatchEvent(new CustomEvent('pali-app-ready'));
    }, 100);

    // Fallback timer - only runs if app wasn't already loaded
    const fallbackTimer = setTimeout(() => {
      if (!document.body.classList.contains('app-loaded')) {
        console.log(
          '[App] Fallback: Dispatching pali-app-ready event after 3 seconds'
        );
        window.dispatchEvent(new CustomEvent('pali-app-ready'));
      }
    }, 1000);

    const messageListener = ({ type }) => {
      if (type === 'logout') {
        // Navigate to the home page after logout
        window.location.hash = '';
        window.location.replace('/app.html#');
      }
    };

    // Add the listener when the component mounts
    chrome.runtime.onMessage.addListener(messageListener);

    // 🔥 Emergency save when popup closes
    const performEmergencySave = () => {
      console.log('[App] Popup closing, triggering emergency save...');
      vaultCache.emergencySave().catch((error) => {
        console.error('[App] Failed to emergency save on popup close:', error);
      });
    };

    // unload only fires when popup is actually being closed/destroyed (not just hidden)
    window.addEventListener('unload', performEmergencySave);

    // Cleanup: remove all listeners when the component unmounts
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      window.removeEventListener('unload', performEmergencySave);
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleanup on unmount

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
