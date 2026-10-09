/* eslint-disable import/no-extraneous-dependencies */
// Critical styles - loaded by webpack
import 'assets/styles/index.css';
import 'assets/fonts/index.css';
import 'react-toastify/dist/ReactToastify.css';

// Non-critical styles - still loaded but lower priority
import 'assets/styles/antd-overrides.css';
import 'assets/styles/custom-checkbox.css';

// Import React and dependencies statically to enable webpack optimization
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ToastContainer } from 'react-toastify';

import { AntdProvider } from 'components/AntdProvider';
import { WalletBootstrap } from 'components/WalletBootstrap/WalletBootstrap';
import store from 'state/store';

// Initialize i18n for the app
import 'utils/i18n';

import App from './App';

// Make this file a module to satisfy TypeScript's isolatedModules
export {};

// Check if this is an offscreen document - if so, just exit
// The offscreen document only needs to load the bundles for caching
if (window.__PALI_OFFSCREEN__) {
  console.log(
    '[App] Running in offscreen document - skipping app initialization'
  );
  // Exit early - we've already loaded all the bundles which is what we wanted
} else {
  // Only run the app if we're not in offscreen mode
  const appRootElement = document.getElementById('app-root');

  if (appRootElement) {
    console.log('[App] Starting app initialization...');

    // Now initialize the app
    const initializeApp = async () => {
      try {
        console.log('[App] Starting React app initialization...');

        const AppWrapper = () => {
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

          return (
            <Provider store={store}>
              <AntdProvider>
                <WalletBootstrap>
                  <App />
                  <ToastContainer {...toastOptions} />
                </WalletBootstrap>
              </AntdProvider>
            </Provider>
          );
        };

        // Create root and render
        const root = ReactDOM.createRoot(appRootElement);
        root.render(
          <React.StrictMode>
            <AppWrapper />
          </React.StrictMode>
        );
        console.log('[App] React app rendered');
      } catch (error) {
        console.error('[App] Failed to initialize app:', error);
        appRootElement.innerHTML =
          '<div style="color: white; padding: 20px;">Failed to load wallet. Please refresh.</div>';
      }
    };

    // Start loading immediately
    initializeApp();
  } else {
    console.error("Failed to find the root element with ID 'app-root'.");
  }
}
