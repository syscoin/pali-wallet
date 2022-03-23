import React, { FC } from 'react';
import { Container } from 'components/index';
import { Router } from 'routers/index';
import { BrowserRouter } from 'react-router-dom';

const App: FC = () => (
  <Container>
    <BrowserRouter>
      <div className="min-w-popup min-h-popup">
        <Router />
      </div>
    </BrowserRouter>
  </Container>
);

export default App;
