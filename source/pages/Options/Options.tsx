import React, { FC } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Container } from 'components/index';

import { About } from '..';

const Options: FC = () => (
  <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
    <Container>
      <BrowserRouter>
        <About />
      </BrowserRouter>
    </Container>
  </section>
);

export default Options;
