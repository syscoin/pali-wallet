import React, { FC, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';

import { Container, KeepAliveContainer } from 'components/index';
import { Router } from 'routers/index';
import { vaultCache } from 'state/vaultCache';

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

    const handleBeforeUnload = () => {
      vaultCache.emergencySave().catch((error) => {
        console.error('[App] Failed to emergency save on beforeunload:', error);
      });
    };

    // 🔥 Only trigger emergency save on actual page unload, not just tab switching
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup: remove the listener when the component unmounts
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleanup on unmount

  // other logic
  return (
    <section className="mx-auto h-full min-w-popup min-h-popup md:max-w-2xl">
      <KeepAliveContainer />
      <Container>
        <HashRouter>
          <div className="w-full min-w-popup h-full min-h-popup">
            <Router />
          </div>
        </HashRouter>
      </Container>
    </section>
  );
};

export default App;
