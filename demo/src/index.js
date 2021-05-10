import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter, Switch, Route } from 'react-router-dom';

import App from './App';
import './index.scss';

import MintNFT from './MintNFT';
import MintSPT from './MintSPT';
import createSPT from './createSpt';
import CreateCollection from './createCollection';
//v
ReactDOM.render(
  <BrowserRouter>
    <Switch>
      <Route path="/" exact={true} component={App} />
      <Route path="/mintnft" component={MintNFT} />
      <Route path="/mintspt" component={MintSPT} />
      <Route path="/createspt" component={createSPT} />
      <Route path="/createcollection" component={CreateCollection} />
    </Switch>
  </BrowserRouter>,
  document.getElementById('root')
);
