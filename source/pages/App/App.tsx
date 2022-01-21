import React, { FC, useEffect, useState } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import Container from 'containers/common/Container/index';
import { AuthRouter, UnAuthRouter } from 'routers/index';
import { useStore } from 'hooks/index';
import { checkForSyscoinNetwork } from 'scripts/Background/gateway';

const App: FC = () => {
  const [syscoinRoute, setSyscoinRoute] = useState<boolean | undefined>(false);

  const { encriptedMnemonic } = useStore();

  useEffect(() => {
    const setup = async () => {
      try {
        const response = await checkForSyscoinNetwork({ blockbookURL: 'asd' });

        setSyscoinRoute(response);
      } catch (error) {
        console.log('error fetching route');
      }
    };

    setup();
  }, []);

  return (
    <section className="min-w-popup bg-bkg-2">
      <Container>
        <Router>{encriptedMnemonic ? <AuthRouter /> : <UnAuthRouter />}</Router>
      </Container>
    </section>
  );
};

export default App;
