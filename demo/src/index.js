import React from 'react';
import ReactDOM from 'react-dom';

import App from './App';
import './index.scss';
import { BrowserRouter, Switch, Route } from 'react-router-dom';
import sysmint from './sysmint';

ReactDOM.render(
  <BrowserRouter>
          <Switch>
            <Route path="/" exact={true} component={App} />
            <Route path="/sysmint" component={sysmint} />
            </Switch>
  </BrowserRouter>,
  document.getElementById('root')

);
