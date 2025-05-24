import React, { FC } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { Container, KeepAliveContainer } from 'components/index';
import { ExternalRoute } from 'routers/ExternalRoute';

const External: FC = () => (
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

export default External;
