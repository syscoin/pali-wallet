import React, { FC } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Container } from 'components/index';
import { ExternalRoute } from 'routers/ExternalRoute';

const External: FC = () => (
  // Don't signal app ready here - let the actual route components handle it
  // Start component (for unauthenticated) and route components (for authenticated)
  // will signal when they have content ready

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
export default External;
