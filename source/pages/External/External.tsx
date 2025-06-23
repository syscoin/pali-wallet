import React, { FC, useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Container } from 'components/index';
import { ExternalRoute } from 'routers/ExternalRoute';

const External: FC = () => {
  useEffect(() => {
    // Signal that the React app is ready after mounting
    const timer = setTimeout(() => {
      console.log('[External] Dispatching pali-app-ready event');
      window.dispatchEvent(new CustomEvent('pali-app-ready'));
    }, 100);

    // Fallback timer - only runs if app wasn't already loaded
    const fallbackTimer = setTimeout(() => {
      if (!document.body.classList.contains('app-loaded')) {
        console.log(
          '[External] Fallback: Dispatching pali-app-ready event after 3 seconds'
        );
        window.dispatchEvent(new CustomEvent('pali-app-ready'));
      }
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <section className="mx-auto min-w-popup h-full min-h-popup md:max-w-2xl">
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
