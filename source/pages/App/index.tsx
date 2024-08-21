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
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { ToastAlert } from 'components/index';
import MigrationController from 'scripts/Background/controllers/MigrationController';
import { handleRehydrateStore } from 'scripts/Background/handlers/handleRehydrateStore';
import { handleStoreSubscribe } from 'scripts/Background/handlers/handleStoreSubscribe';
import rehydrateStore from 'state/rehydrate';
import store from 'state/store';

import App from './App';

const app = document.getElementById('app-root');
// const store = new Store({ portName: STORE_PORT });

// const w = watch(appStore.getState, 'vault.lastLogin');
// store.subscribe(
//   w(() => {
//     log('watching webext store');
//   })
// );

const options = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};

handleRehydrateStore();

MigrationController().then(() => {
  rehydrateStore(store).then(() => {
    // Render App
    ReactDOM.render(
      <Provider store={store}>
        <AlertProvider template={ToastAlert} {...options}>
          <App />
        </AlertProvider>
      </Provider>,
      app
    );

    // Subscribe store to updates and notify
    handleStoreSubscribe(store);
  });
});
