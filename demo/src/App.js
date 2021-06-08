import { useState } from "react";
import { BrowserRouter, Route, Switch } from "react-router-dom";
import { Provider } from "react-redux";

import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";

import Home from "./routes/Home";
import Dashboard from "./routes/Dashboard";
import MintNFT from "./routes/MintNFT";
import MintSPT from "./routes/MintSPT";
import CreateCollection from "./routes/CreateCollection";
import CreateNFT from "./routes/CreateNFT";
import CreateSPT from "./routes/CreateSPT";
import IssueSPT from "./routes/IssueSPT";
import About from "./routes/About";
import Loader from "./routes/Loader";

import Header from "./components/Header";
import store from "./state/store";

const App = () => {
  const [isLoading, setIsloading] = useState(true);

  return (
    <div className="content">
      <BrowserRouter>
        <Provider store={store}>
          {isLoading ? (
            <Loader loading={setIsloading} />
          ) : (
            <>
              <Header />
              <Switch>
                <Route path="/" exact component={Home} />
                <Route path="/dashboard" exact component={Dashboard} />
                <Route path="/mintnft" component={MintNFT} />
                <Route path="/mintspt" component={MintSPT} />
                <Route path="/create-nft" component={CreateNFT} />
                <Route path="/create-spt" component={CreateSPT} />
                <Route path="/issue-spt" component={IssueSPT} />
                <Route path="/createnft" component={CreateNFT} />
                <Route path="/createcollection" component={CreateCollection} />
                <Route path="/about" component={About} />
              </Switch>
            </>
          )}
        </Provider>
      </BrowserRouter>
    </div>
  );
};

export default App;
