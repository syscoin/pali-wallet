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
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import { ToastAlert } from 'components/index';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { handleStoreSubscribe } from 'scripts/Background/controllers/handlers';
import MigrationController from 'scripts/Background/controllers/MigrationController';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

import App from './App';

const appRootElement = document.getElementById('app-root');

const options = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};

if (appRootElement) {
  MigrationController().then(async () => {
    const state = await controllerEmitter(['wallet', 'getState']);

    rehydrateStore(store, state).then(() => {
      const root = ReactDOM.createRoot(appRootElement);
      root.render(
        <React.StrictMode>
          <Provider store={store}>
            <AlertProvider template={ToastAlert} {...options}>
              <App />
            </AlertProvider>
          </Provider>
        </React.StrictMode>
      );

      // Subscribe store to updates
      handleStoreSubscribe(store);
    });
  });
} else {
  console.error("Failed to find the root element with ID 'app-root'.");
}
