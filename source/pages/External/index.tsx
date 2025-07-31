/* eslint-disable import/no-extraneous-dependencies */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import { clearNavigationState } from 'utils/navigationState';
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
import 'assets/fonts/index.css';
import 'assets/styles/custom-send-utxo-input.css';

import External from './External';

const externalRootElement = document.getElementById('external-root');

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

if (externalRootElement) {
  // Clear navigation state for external popups to ensure they don't restore state
  clearNavigationState()
    .then(() => {
      console.log('[External] Cleared navigation state for external popup');
      return rehydrateStore(store);
    })
    .then(() => {
      const root = ReactDOM.createRoot(externalRootElement);
      root.render(
        <React.StrictMode>
          <Provider store={store}>
            <External />
            <ToastContainer {...toastOptions} />
          </Provider>
        </React.StrictMode>
      );
    });
} else {
  console.error("Failed to find the root element with ID 'external-root'.");
}

export { default as External } from './External';
