import React, { FC } from 'react';
import { Container } from 'components/index';
import { ExternalRoute } from 'routers/ExternalRoute';
import { BrowserRouter } from 'react-router-dom';

const External: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
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
