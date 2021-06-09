import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Switch, Route } from 'react-router-dom';

import App from './App';
import './index.scss';

import MintNFT from './Mint/MintNFT';
import MintSPT from './Mint/MintSPT';
import CreateSPT from './Create/CreateSPT';
import CreateCollection from './Create/CreateCollection';
import CreateNFT from './Create/CreateNFT';
import UpdateAsset from './Update/UpdateAsset';
import TransferOwnership from './TransferOwnership/TransferOwnership';

ReactDOM.render(
  <BrowserRouter>
    <Switch>
      <Route
        path="/"
        exact={true}
        component={App}
      />
      <Route path="/mintnft" component={MintNFT} />
      <Route path="/mintspt" component={MintSPT} />
      <Route path="/createnft" component={CreateNFT} />
      <Route path="/createspt" component={CreateSPT} />
      <Route path="/createnft" component={CreateNFT} />
      <Route path="/createcollection" component={CreateCollection} />
      <Route path="/updateasset" component={UpdateAsset} />
      <Route path="/transferownership" component={TransferOwnership} />
    </Switch>
  </BrowserRouter>,
  document.getElementById('root')
);