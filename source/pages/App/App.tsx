import React, { FC, Suspense, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';

import { Container, Loading, KeepAliveContainer } from 'components/index';
import { Router } from 'routers/index';

const App: FC = () => {
  useEffect(() => {
    // Signal that the React app is ready after mounting
    const timer = setTimeout(() => {
      document.body.classList.add('app-loaded');
      console.log('[App] Added app-loaded class to body');
    }, 100);

    // Fallback timer
    const fallbackTimer = setTimeout(() => {
      if (!document.body.classList.contains('app-loaded')) {
        document.body.classList.add('app-loaded');
        console.log('[App] Fallback: Added app-loaded class after 3 seconds');
      }
    }, 3000);

    const messageListener = ({ action }) => {
      if (action === 'logoutFS') {
        // Navigate to the home page
        // replace this with your React routing logic
        window.location.hash = '';
        window.location.replace('/app.html#');
      }
    };

    // Add the listener when the component mounts
    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup: remove the listener when the component unmounts
    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleanup on unmount

  // other logic
  return (
    <section className="mx-auto h-full min-w-popup min-h-popup bg-brand-blue700 md:max-w-2xl transition-all duration-200 ease-in-out">
      <KeepAliveContainer />
      <Suspense fallback={<Loading />}>
        <Container>
          <HashRouter>
            <div className="w-full min-w-popup h-full min-h-popup transition-all duration-200 ease-in-out">
              <Router />
            </div>
          </HashRouter>
        </Container>
      </Suspense>
    </section>
  );
};

export default App;
