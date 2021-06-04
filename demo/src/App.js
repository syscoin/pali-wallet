import { useState } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import { Provider } from "react-redux";
import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";

import Home from "./routes/Home";
import MintNFT from "./routes/MintNFT";
import MintSPT from "./routes/MintSPT";
import CreateCollection from "./routes/Create/CreateCollection";
import CreateNFT from "./routes/Create/CreateNFT";
import CreateSPT from "./routes/Create/CreateSPT";
import Loader from "./routes/Loader";

import Header from "./components/Header";
import store from "./state/store";

const App = () => {
  const [isLoading, setIsloading] = useState(true);

  return (
    <div className="app">
      <BrowserRouter>
        <Provider store={store}>
          {isLoading ? (
            <Loader loading={setIsloading} />
          ) : (
            <>
              <Header />
              <Switch>
                <Route path="/" exact component={Home} />
                <Route path="/mintnft" component={MintNFT} />
                <Route path="/mintspt" component={MintSPT} />
                <Route path="/createnft" component={CreateNFT} />
                <Route path="/createspt" component={CreateSPT} />
                <Route path="/createnft" component={CreateNFT} />
                <Route path="/createcollection" component={CreateCollection} />
              </Switch>
            </>
          )}
        </Provider>
      </BrowserRouter>
    </div>
  );
};

export default App;
