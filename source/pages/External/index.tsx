/* eslint-disable import/no-extraneous-dependencies */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AntdProvider } from 'components/AntdProvider';
import { WalletBootstrap } from 'components/WalletBootstrap/WalletBootstrap';
import store from 'state/store';
import { clearNavigationState } from 'utils/navigationState';
import 'assets/styles/index.css';
import 'assets/styles/antd-overrides.css';
import 'assets/styles/custom-checkbox.css';
import 'assets/fonts/index.css';

// Initialize i18n for external pages
import 'utils/i18n';

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
  // Navigation cleanup is best-effort and must not block the approval UI.
  void clearNavigationState();
  const root = ReactDOM.createRoot(externalRootElement);
  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <AntdProvider>
          <WalletBootstrap>
            <External />
            <ToastContainer {...toastOptions} />
          </WalletBootstrap>
        </AntdProvider>
      </Provider>
    </React.StrictMode>
  );
} else {
  console.error("Failed to find the root element with ID 'external-root'.");
}

export { default as External } from './External';
