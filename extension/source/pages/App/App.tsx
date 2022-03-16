import React, { FC } from 'react';
import { useSelector } from 'react-redux';
import { BrowserRouter as Router } from 'react-router-dom';
import Container from 'containers/common/Container';
import AuthRouter from 'routers/Auth';
import UnAuthRouter from 'routers/UnAuth';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';

import 'assets/styles/global.scss';

const App: FC = () => {
  const { encriptedMnemonic }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  return (
    <section id="app" style={{ minHeight: '300px' }}>
      <Container>
        <Router>
          {encriptedMnemonic !== null ? <AuthRouter /> : <UnAuthRouter />}
        </Router>
      </Container>
    </section>
  );
};

export default App;
