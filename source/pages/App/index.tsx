/* eslint-disable import/no-extraneous-dependencies */
// Critical styles - loaded by webpack
import 'assets/styles/index.css';
import 'assets/fonts/index.css';
import 'react-toastify/dist/ReactToastify.css';

// Non-critical styles - still loaded but lower priority
import 'assets/styles/custom-input-password.css';
import 'assets/styles/custom-input-normal.css';
import 'assets/styles/custom-input-search.css';
import 'assets/styles/custom-checkbox.css';
import 'assets/styles/custom-form-inputs-styles.css';
import 'assets/styles/custom-autolock-input.css';
import 'assets/styles/custom-receive-input.css';
import 'assets/styles/custom-import-token-input.css';
import 'assets/styles/custom-send-utxo-input.css';

// Import React and dependencies statically to enable webpack optimization
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { ToastContainer } from 'react-toastify';

import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';

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

        // Create a wrapper component that manages the loading state
        const AppWrapper = () => {
          const [isReady, setIsReady] = React.useState(false);

          React.useEffect(() => {
            // Initialize store and state
            const initializeState = async () => {
              try {
                // Load from cached state immediately for fast UI rendering
                try {
                  await rehydrateStore(store);
                  setIsReady(true);
                  console.log('[App] Rendered with cached state');
                } catch (cacheError) {
                  console.log('[App] No cached state available');
                  // Even without cached state, we can still render with defaults
                  setIsReady(true);
                }

                // Fresh state updates are handled by useRouterLogic via CONTROLLER_STATE_CHANGE messages
                console.log(
                  '[App] Initial state loaded, router will handle updates'
                );
              } catch (error) {
                console.error(
                  '[App] Error during state initialization:',
                  error
                );
                // Still allow the app to render with default state
                setIsReady(true);
              }
            };

            initializeState();
          }, []);

          // Keep showing loading state while initializing
          if (!isReady) {
            return null; // The vanilla JS loading screen is still visible
          }

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
              <App />
              <ToastContainer {...toastOptions} />
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
