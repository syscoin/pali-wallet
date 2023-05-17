import React, { FC } from 'react';
import { HashRouter } from 'react-router-dom';

import { Container } from 'components/index';
import { Router } from 'routers/index';

const App: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
    <Container>
      <HashRouter>
        <div className="w-full min-w-popup h-full min-h-popup">
          <Router />
        </div>
      </HashRouter>
    </Container>
  </section>
);

export default App;
