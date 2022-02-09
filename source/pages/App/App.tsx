import React, { FC } from 'react';
import Container from 'pages/Container';
import { AuthRouter } from 'routers/index';
import { BrowserRouter } from 'react-router-dom';

const App: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
    <Container>
      <BrowserRouter>
        <AuthRouter />
      </BrowserRouter>
    </Container>
  </section>
);

export default App;
