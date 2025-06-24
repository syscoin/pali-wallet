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

import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import MigrationController from 'scripts/Background/controllers/MigrationController';
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
    const initStartTime = performance.now();

    // Show loading screen immediately with vanilla JS
    appRootElement.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: #07152b;
      ">
        <div style="
          display: flex;
          gap: 12px;
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        ">
          <h1 style="
            font-size: 37.87px;
            line-height: 37.87px;
            letter-spacing: 0.379px;
            color: #4da2cf;
            font-weight: 700;
            margin: 0;
            font-family: 'Poppins', sans-serif;
          ">Pali</h1>
          <h1 style="
            font-size: 37.87px;
            line-height: 37.87px;
            letter-spacing: 0.379px;
            color: #4da2cf;
            font-weight: 300;
            margin: 0;
            font-family: 'Poppins', sans-serif;
          ">Wallet</h1>
        </div>
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
    `;

    console.log(
      `[App] Loading screen shown after ${(
        performance.now() - initStartTime
      ).toFixed(2)}ms`
    );

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
                const stateLoadStart = performance.now();

                // FIRST: Try to load from cached state immediately
                try {
                  await rehydrateStore(store);
                  setIsReady(true);
                  console.log('[App] Rendered with cached state');
                } catch (cacheError) {
                  console.log('[App] No cached state available');
                  // Even without cached state, we can still render with defaults
                  setIsReady(true);
                }

                // THEN: Try to fetch fresh state from background (non-blocking)
                const fetchFreshState = async () => {
                  try {
                    console.log(
                      '[App] Fetching fresh state from background script...'
                    );

                    // Use a shorter timeout for background readiness check
                    let bgReady = false;
                    for (let i = 0; i < 3; i++) {
                      try {
                        const pingResponse = await new Promise(
                          (resolve, reject) => {
                            const timeout = setTimeout(
                              () => reject(new Error('Timeout')),
                              500
                            );
                            chrome.runtime.sendMessage(
                              { type: 'ping' },
                              (response) => {
                                clearTimeout(timeout);
                                if (chrome.runtime.lastError) {
                                  reject(chrome.runtime.lastError);
                                } else {
                                  resolve(response);
                                }
                              }
                            );
                          }
                        );

                        if ((pingResponse as any)?.ready) {
                          console.log('[App] Background script is ready');
                          bgReady = true;
                          break;
                        }
                      } catch (error) {
                        // Silent - we'll try again
                      }
                      await new Promise((resolve) => setTimeout(resolve, 200));
                    }

                    if (!bgReady) {
                      // Background not ready yet - that's ok, we already have UI loaded
                      // Schedule a retry in the background
                      setTimeout(() => fetchFreshState(), 2000);
                      return;
                    }

                    // Try to get fresh state
                    try {
                      const state = await controllerEmitter([
                        'wallet',
                        'getState',
                      ]);
                      console.log(
                        `[App] Fresh state fetched in ${(
                          performance.now() - stateLoadStart
                        ).toFixed(2)}ms`
                      );

                      if (state && typeof state === 'object') {
                        // Validate that we have valid state data
                        const stateObj = state as any;
                        if (stateObj.vault || stateObj.vaultGlobal) {
                          // Run migrations on fresh state
                          const migrationStart = performance.now();
                          console.log('[App] Running MigrationController...');
                          await MigrationController(state);
                          console.log(
                            `[App] Migrations completed in ${(
                              performance.now() - migrationStart
                            ).toFixed(2)}ms`
                          );

                          // Update store with fresh state
                          const rehydrateStart = performance.now();
                          await rehydrateStore(store, state);
                          console.log(
                            `[App] Store updated with fresh state in ${(
                              performance.now() - rehydrateStart
                            ).toFixed(2)}ms`
                          );
                        } else {
                          console.log(
                            '[App] Invalid state structure received, skipping update'
                          );
                        }
                      }
                    } catch (error: any) {
                      // Retry later if it's a connection error
                      if (
                        error?.message?.includes(
                          'Could not establish connection'
                        ) ||
                        error?.message?.includes(
                          'Receiving end does not exist'
                        ) ||
                        error?.message?.includes(
                          'Failed to connect to service worker'
                        )
                      ) {
                        console.log(
                          '[App] Service worker connection error, retrying in 5s...'
                        );
                        setTimeout(() => fetchFreshState(), 5000);
                      } else {
                        console.error(
                          '[App] Error fetching fresh state:',
                          error
                        );
                      }
                    }

                    console.log(
                      `[App] Total initialization time: ${(
                        performance.now() - initStartTime
                      ).toFixed(2)}ms`
                    );
                  } catch (error) {
                    // Silent fail - we already have UI loaded
                  }
                };

                // Fetch fresh state in the background (non-blocking)
                setTimeout(() => fetchFreshState(), 100);
              } catch (error) {
                console.error('[App] Failed to initialize state:', error);
                // Still render the app even if state initialization fails
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
        const renderStart = performance.now();
        const root = ReactDOM.createRoot(appRootElement);
        root.render(
          <React.StrictMode>
            <AppWrapper />
          </React.StrictMode>
        );
        console.log(
          `[App] React app rendered in ${(
            performance.now() - renderStart
          ).toFixed(2)}ms`
        );
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
