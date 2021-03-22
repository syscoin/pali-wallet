import { STORE_PORT } from 'constants/index';

import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Store } from 'webext-redux';
import watch from 'redux-watch';
import { transitions, positions, Provider as AlertProvider } from 'react-alert';

import ToastAlert from 'components/ToastAlert';
import appStore from 'state/store';

import App from './App';

const app = document.getElementById('app-root');
const store = new Store({ portName: STORE_PORT });

const w = watch(appStore.getState, 'wallet.status');
store.subscribe(
  w(() => {
    location.reload();
  })
);

const options = {
  // you can also just use 'bottom center'
  position: positions.BOTTOM_CENTER,
  timeout: 20 * 1000,
  offset: '30px',
  // you can also just use 'scale'
  transition: transitions.FADE,
};

store.ready().then(() => {
  ReactDOM.render(
    <Provider store={store}>
      <AlertProvider template={ToastAlert} {...options}>
        <App />
      </AlertProvider>
    </Provider>,
    app
  );
});
