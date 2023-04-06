import React, { FC } from 'react';
import { useSelector } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';

import { Container, Loading } from 'components/index';
import { Router } from 'routers/index';
import { RootState } from 'state/store';

const App: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
    <Container>
      <BrowserRouter>
        <div className="w-full min-w-popup h-full min-h-popup">
          <Router />
        </div>
      </BrowserRouter>
    </Container>
  </section>
);

export default App;
