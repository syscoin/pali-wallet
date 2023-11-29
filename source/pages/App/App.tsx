import React, { FC, Suspense, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { browser } from 'webextension-polyfill-ts';

import { Container, Loading } from 'components/index';
import { Router } from 'routers/index';

const App: FC = () => {
  useEffect(() => {
    // Ensure compatibility between browsers

    const messageListener = ({ action }) => {
      if (action === 'logoutFS') {
        // Navigate to the home page
        // replace this with your React routing logic
        window.location.hash = '';
        window.location.replace('/app.html#');
      }
    };

    // Add the listener when the component mounts
    browser.runtime.onMessage.addListener(messageListener);

    // Cleanup: remove the listener when the component unmounts
    return () => {
      browser.runtime.onMessage.removeListener(messageListener);
    };
  }, []); // Empty dependency array means this effect runs once on mount and cleanup on unmount

  // other logic
  return (
    <section className="mx-auto min-w-popup min-h-popup bg-brand-blue700 md:max-w-2xl">
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
