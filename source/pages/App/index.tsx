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

// import { Store } from '@eduardoac-skimlinks/webext-redux';
import React from 'react';
import { transitions, positions, Provider as AlertProvider } from 'react-alert';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import watch from 'redux-watch';
import { browser } from 'webextension-polyfill-ts';

import { ToastAlert } from 'components/index';
import { STORE_PORT } from 'constants/index';
import { ProxyStore } from 'scripts/Background';
import appStore from 'state/store';
import { log, parseJsonRecursively } from 'utils/index';

import App from './App';

const app = document.getElementById('app-root');
const store = new ProxyStore({ portName: STORE_PORT });

const w = watch(appStore.getState, 'vault.lastLogin');
store.subscribe(
  w(() => {
    log('watching webext store');
  })
);
store.subscribe(() => {
  browser.storage.local.set({ vault: appStore.getState().vault });
});

const options = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};
const handleServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/js/background.bundle.js', {
        scope: '/',
        updateViaCache: 'all',
      })
      .then(function (registration) {
        // Registration was successful
        console.log(
          'ServiceWorker registration successful with scope: ',
          registration.scope,
          registration
        );
      })
      .catch(function (err) {
        // registration failed :(
        console.log('ServiceWorker registration failed: ', err);
      });
  }
};

handleServiceWorker();
navigator.serviceWorker
  .getRegistration('/js/background.bundle.js')
  .then(function (registration) {
    registration.update();
  });

store.ready().then(() => {
  chrome.storage.onChanged.addListener((e) => {
    console.log({ e });
  });
  const update = (changes) => {
    if (changes?.['persist:root']?.newValue === undefined) return;
    const newState = parseJsonRecursively(changes?.['persist:root']?.newValue);
    store.replaceState(newState);
  };
  chrome.storage.onChanged.addListener(update);
  ReactDOM.render(
    <Provider store={store}>
      <AlertProvider template={ToastAlert} {...options}>
        <App />
      </AlertProvider>
    </Provider>,
    app
  );
});
