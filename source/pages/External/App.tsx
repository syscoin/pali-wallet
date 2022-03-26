import React, { FC } from 'react';
import { Container } from 'components/index';
import { ExternalRouter } from 'routers/index';
import { BrowserRouter } from 'react-router-dom';

const App: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
    <Container>
      <BrowserRouter>
        <div className="w-full min-w-popup h-full min-h-popup">
          <ExternalRouter />
        </div>
      </BrowserRouter>
    </Container>
  </section>
);

export default App;
