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
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ToastContainer } from 'react-toastify';

import 'react-toastify/dist/ReactToastify.css';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { handleStoreSubscribe } from 'scripts/Background/controllers/handlers';
import MigrationController from 'scripts/Background/controllers/MigrationController';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

import App from './App';

const appRootElement = document.getElementById('app-root');

const toastOptions = {
  position: 'bottom-center' as const,
  autoClose: 2 * 1000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

if (appRootElement) {
  console.log('[App] Starting app initialization...');
  MigrationController().then(async () => {
    console.log('[App] MigrationController completed, getting state...');
    try {
      const state = await controllerEmitter(['wallet', 'getState']);
      console.log('[App] Successfully got state from background script');

      rehydrateStore(store, state).then(() => {
        console.log('[App] Store rehydrated, rendering React app...');
        const root = ReactDOM.createRoot(appRootElement);
        root.render(
          <React.StrictMode>
            <Provider store={store}>
              <App />
              <ToastContainer {...toastOptions} />
            </Provider>
          </React.StrictMode>
        );

        // Subscribe store to updates
        handleStoreSubscribe(store);
        console.log('[App] App rendered and store subscribed');
      });
    } catch (error) {
      console.error('[App] Failed to get state from background script:', error);
      // Still try to render the app even if initial state fetch fails
      console.log('[App] Attempting to render app without initial state...');
      rehydrateStore(store).then(() => {
        const root = ReactDOM.createRoot(appRootElement);
        root.render(
          <React.StrictMode>
            <Provider store={store}>
              <App />
              <ToastContainer {...toastOptions} />
            </Provider>
          </React.StrictMode>
        );
        handleStoreSubscribe(store);
      });
    }
  });
} else {
  console.error("Failed to find the root element with ID 'app-root'.");
}
