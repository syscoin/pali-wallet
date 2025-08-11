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

// Initialize i18n for the app
import 'utils/i18n';

import App from './App';

// Make this file a module to satisfy TypeScript's isolatedModules
export {};

{
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
              setIsReady(true);
              // Architecture: Single source of truth state management
              //
              // State Flow:
              // 1. Initial Load: App.tsx requests state from background via getCurrentState
              // 2. Ongoing Updates: Background broadcasts CONTROLLER_STATE_CHANGE messages
              //    which are handled by useRouterLogic for real-time updates
              // 3. Visibility Changes: App.tsx re-syncs when popup becomes visible
              //
              // Benefits:
              // - No double rehydration on startup
              // - Background is the authoritative source
              // - Consistent state across all contexts
              // - Efficient - no duplicate blockchain calls

              try {
                // Request state from background (the source of truth)
                chrome.runtime.sendMessage(
                  { type: 'getCurrentState' },
                  (backgroundState) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        '[App] Error getting state from background:',
                        chrome.runtime.lastError
                      );
                      return;
                    }

                    if (backgroundState) {
                      console.log(
                        '[App] Received state from background, rehydrating'
                      );
                      // Rehydrate with background state
                      rehydrateStore(store, backgroundState);

                      console.log('[App] Rendered with background state');
                    } else {
                      console.log(
                        '[App] No state from background, using defaults'
                      );
                    }
                  }
                );

                // Also ensure polling is running for future updates
                // This doesn't trigger immediate blockchain calls, just ensures the schedule is set
                chrome.runtime.sendMessage({ type: 'startPolling' });
              } catch (error) {
                console.error('[App] Error during initialization:', error);
                // Fallback: allow render with default state
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
