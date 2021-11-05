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
  const [isUnlocked, setIsUnlocked] = useState(false);

  window.onload = async function () {
    await setupState(store);

    const {
      controller,
      isInstalled,
      isLocked,
      connected,
    } = store.getState();

    setIsConnected(connected);
    setIsUnlocked(!isLocked);
    setIsloading(!isLoading);

    isInstalled && controller.onWalletUpdate(async function () {
      await setupState(store);

      const {
        isLocked,
        connected
      } = store.getState();

      setIsUnlocked(!isLocked);
      setIsConnected(connected);
    });
  };

  store.subscribe(() => {
    const { connected } = store.getState();

    setIsConnected(connected)
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
                  component={!isConnected || !isUnlocked ? Home : Dashboard}
                />
                {isConnected && isUnlocked ? (
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
