import React from 'react';
import ReactDOM from 'react-dom';

import App from './App';
import './index.scss';
import { BrowserRouter, Switch, Route } from 'react-router-dom';
import Mintnft from './mintnft';
import Mintspt from './mintspt';
import createSPT from './createSpt'
import CreateCollection from './createCollection'
ReactDOM.render(
  <BrowserRouter>
          <Switch>
            <Route path="/" exact={true} component={App} />
            <Route path="/mintnft" component={Mintnft} />
            <Route path="/mintspt" component={Mintspt} />
            <Route path="/createspt" component={createSPT} />
            <Route path="/createcollection" component={CreateCollection} />
            </Switch>
  </BrowserRouter>,
  document.getElementById('root')

);
