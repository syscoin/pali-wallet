import React, { FC } from 'react';
import Container from 'containers/common/Container';
import { AuthRouter } from 'routers/index';

const App: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
    <Container>
      <AuthRouter />
    </Container>
  </section>
);

export default App;
