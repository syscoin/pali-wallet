// import Start from 'containers/unauth/Start';
import React, { FC } from 'react';
// import { useSelector } from 'react-redux';
import { BrowserRouter as Router } from 'react-router-dom';
import Container from 'containers/common/Container/index';
// import AuthRouter from 'routers/Auth';
import UnAuthRouter from 'routers/UnAuth';
// import { RootState } from 'state/store';
// import IWalletState from 'state/wallet/types';

const App: FC = () => {
  // const { encriptedMnemonic }: IWalletState = useSelector(
  //   (state: RootState) => state.wallet
  // );

  return (
    <section className="min-w-popup">
      <Container>
        <Router>
          <UnAuthRouter />
          {/* {encriptedMnemonic !== null ? <AuthRouter /> : <UnAuthRouter />} */}
        </Router>
      </Container>
    </section>
  );
};

export default App;
