import React, { FC } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import Container from 'containers/common/Container/index';
import AuthRouter from 'routers/Auth';
import UnAuthRouter from 'routers/UnAuth';
import { useStore } from 'hooks/index';

const App: FC = () => {
  const { encriptedMnemonic } = useStore();

  return (
    <section className="min-w-popup">
      <Container>
        <Router>
          {encriptedMnemonic ? <AuthRouter /> : <UnAuthRouter />}
        </Router>
      </Container>
    </section>
  );
};

export default App;
