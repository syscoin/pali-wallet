import React, { FC, Suspense, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';

import { Container, Loading, KeepAliveContainer } from 'components/index';
import { Router } from 'routers/index';

const App: FC = () => {
  useEffect(() => {
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
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleanup on unmount

  // other logic
  return (
    <section className="mx-auto h-full min-w-popup min-h-popup bg-brand-blue700 md:max-w-2xl">
      <KeepAliveContainer />
      <Suspense fallback={<Loading />}>
        <Container>
          <HashRouter>
            <div className="w-full min-w-popup h-full min-h-popup">
              <Router />
            </div>
          </HashRouter>
        </Container>
      </Suspense>
    </section>
  );
};

export default App;
