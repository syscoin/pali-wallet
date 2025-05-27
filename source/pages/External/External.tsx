import React, { FC, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Container, KeepAliveContainer } from 'components/index';
import { ExternalRoute } from 'routers/ExternalRoute';

const External: FC = () => {
  useEffect(() => {
    // Signal that the React app is ready after mounting
    const timer = setTimeout(() => {
      document.body.classList.add('app-loaded');
      console.log('[External] Added app-loaded class to body');
    }, 100);

    // Fallback timer
    const fallbackTimer = setTimeout(() => {
      if (!document.body.classList.contains('app-loaded')) {
        document.body.classList.add('app-loaded');
        console.log(
          '[External] Fallback: Added app-loaded class after 3 seconds'
        );
      }
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <section className="mx-auto min-w-popup h-full min-h-popup md:max-w-2xl">
      <KeepAliveContainer />
      <Container>
        <BrowserRouter>
          <div className="w-full min-w-popup h-full min-h-popup">
            <ExternalRoute />
          </div>
        </BrowserRouter>
      </Container>
    </section>
  );
};

export default External;
