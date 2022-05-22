import React, { FC } from 'react';
import { Container, Loading } from 'components/index';
import { Router } from 'routers/index';
import { BrowserRouter } from 'react-router-dom';
import { useStore } from 'hooks/index';

const App: FC = () => {
  const { isPendingBalances } = useStore();

  return (
    <section className="mx-auto min-w-popup h-full min-h-popup bg-bkg-2 md:max-w-2xl">
      <Container>
        <BrowserRouter>
          <div className="w-full min-w-popup h-full min-h-popup">
            {!isPendingBalances ? <Router /> : <Loading />}
          </div>
        </BrowserRouter>
      </Container>
    </section>
  );
};

export default App;
