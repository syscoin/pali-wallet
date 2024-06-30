/* eslint-disable import/no-extraneous-dependencies */
import 'assets/styles/index.css';
import 'assets/styles/custom-input-password.css';
import 'assets/styles/custom-input-normal.css';
import 'assets/styles/custom-input-search.css';
import 'assets/styles/custom-input-normal.css';
import 'assets/styles/custom-checkbox.css';
import 'assets/styles/custom-form-inputs-styles.css';
import 'assets/styles/custom-autolock-input.css';
import 'assets/styles/custom-receive-input.css';
import 'assets/styles/custom-import-token-input.css';
import 'assets/styles/custom-send-utxo-input.css';
import 'assets/fonts/index.css';

import React from 'react';
import { transitions, positions, Provider as AlertProvider } from 'react-alert';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { ToastAlert } from 'components/index';
import {
  handleRehydrateStore,
  handleStoreSubscribe,
} from 'scripts/Background/controllers/handlers';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

import App from './App';

const app = document.getElementById('app-root');

const options = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};

handleRehydrateStore();

rehydrateStore(store).then(() => {
  ReactDOM.render(
    <Provider store={store}>
      <AlertProvider template={ToastAlert} {...options}>
        <App />
      </AlertProvider>
    </Provider>,
    app
  );

  // Subscribe store to updates
  handleStoreSubscribe(store);
});
