/* eslint-disable import/no-extraneous-dependencies */
// Critical styles only - load first
import 'assets/styles/index.css';
import 'assets/fonts/index.css';

// Non-critical styles - will load after app starts
// import 'assets/styles/custom-input-password.css';
// import 'assets/styles/custom-input-normal.css';
// import 'assets/styles/custom-input-search.css';
// import 'assets/styles/custom-checkbox.css';
// import 'assets/styles/custom-form-inputs-styles.css';
// import 'assets/styles/custom-autolock-input.css';
// import 'assets/styles/custom-receive-input.css';
// import 'assets/styles/custom-import-token-input.css';
// import 'assets/styles/custom-send-utxo-input.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
// Lazy load ToastContainer to reduce initial bundle
const ToastContainer = React.lazy(() =>
  import('react-toastify').then((m) => ({ default: m.ToastContainer }))
);

import 'react-toastify/dist/ReactToastify.css';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

import App from './App';

const appRootElement = document.getElementById('app-root');

const toastOptions = {
  position: 'bottom-center' as const,
  autoClose: 2 * 1000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: false,
  draggable: false,
  newestOnTop: false,
  limit: 3,
  closeButton: false,
  className: 'pali-toast',
  toastClassName: 'pali-toast-content',
  progressClassName: 'pali-toast-progress',
};

if (appRootElement) {
  console.log('[App] Starting app initialization...');

  const initializeApp = async () => {
    try {
      console.log('[App] Fetching state from background script...');
      const state = await controllerEmitter(['wallet', 'getState']);
      console.log(
        '[App] Successfully got state from background script:',
        state
      );

      // Run migrations with the fetched state
      console.log('[App] Running MigrationController...');
      const { default: MigrationController } = await import(
        'scripts/Background/controllers/MigrationController'
      );
      await MigrationController(state);
      console.log('[App] MigrationController completed');

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

        // Load non-critical CSS after app is visible
        setTimeout(() => {
          // @ts-ignore
          require('assets/styles/custom-input-password.css');
          // @ts-ignore
          require('assets/styles/custom-input-normal.css');
          // @ts-ignore
          require('assets/styles/custom-input-search.css');
          // @ts-ignore
          require('assets/styles/custom-checkbox.css');
          // @ts-ignore
          require('assets/styles/custom-form-inputs-styles.css');
          // @ts-ignore
          require('assets/styles/custom-autolock-input.css');
          // @ts-ignore
          require('assets/styles/custom-receive-input.css');
          // @ts-ignore
          require('assets/styles/custom-import-token-input.css');
          // @ts-ignore
          require('assets/styles/custom-send-utxo-input.css');
        }, 50);
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
      });
    }
  };

  initializeApp();
} else {
  console.error("Failed to find the root element with ID 'app-root'.");
}
