import { useState } from "react";
import { BrowserRouter, Redirect, Route, Switch } from "react-router-dom";
import { Provider } from "react-redux";

import Home from "./routes/Home";
import Dashboard from "./routes/Dashboard";
import CreateNFT from "./routes/CreateNFT";
import CreateSPT from "./routes/CreateSPT";
import IssueSPT from "./routes/IssueSPT";
import Update from "./routes/Update";
import Transfer from "./routes/Transfer";
import About from "./routes/About";

import Header from "./components/Header";
import store from "./state/store";
import setupState from "./utils/setupState";

const App = () => {
  const [isLoading, setIsloading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  window.onload = async function () {
    const { isConnected: _isConnected, isLocked: _isLocked } = await setupState(store);
    const controller = store.getState().controller;
    const isInstalled = store.getState().isInstalled;

    _isConnected && setIsConnected(_isConnected);
    setIsLocked(_isLocked);
    setIsloading(!isLoading);

    isInstalled && controller.onWalletUpdate(async function () {
      const { isConnected: _isConnected, isLocked: _isLocked } = await setupState(store);

      setIsLocked(_isLocked);
      setIsConnected(_isConnected);
    });
  };

  store.subscribe(() => {
    const _isConnected = store.getState().connected;
    _isConnected !== isConnected && setIsConnected(_isConnected);
  });

  return (
    <div className="content">
      <BrowserRouter>
        <Provider store={store}>
          {isLoading ? (
            <></>
          ) : (
            <>
              <Header />
              <Switch>
                <Route path="/about" component={About} />
                <Route
                  path="/"
                  exact
                  component={!isConnected || isLocked ? Home : Dashboard}
                />
                {isConnected && !isLocked ? (
                  <Switch>
                    <Route path="/create-nft" component={CreateNFT} />
                    <Route path="/create-spt" component={CreateSPT} />
                    <Route path="/issue-spt" component={IssueSPT} />
                    <Route path="/update" component={Update} />
                    <Route path="/transfer" component={Transfer} />
                  </Switch>
                ) : (
                  <Redirect to="/" />
                )}
              </Switch>
            </>
          )}
        </Provider>
      </BrowserRouter>
    </div>
  );
};

export default App;
