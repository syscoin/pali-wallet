/* eslint-disable import/no-extraneous-dependencies */

import React from 'react';
import { transitions, positions, Provider as AlertProvider } from 'react-alert';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';

import { ToastAlert } from 'components/index';
import { handleRehydrateStore } from 'scripts/Background/handlers/handleRehydrateStore';
import { handleStoreSubscribe } from 'scripts/Background/handlers/handleStoreSubscribe';
import MigrationController from 'scripts/Background/MigrationController';
import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
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

const app = document.getElementById('external-root');

const options = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};

handleRehydrateStore();

MigrationController().then(() => {
  rehydrateStore(store).then(() => {
    ReactDOM.render(
      <Provider store={store}>
        <AlertProvider template={ToastAlert} {...options}>
          <External />
        </AlertProvider>
      </Provider>,
      app
    );

    // Subscribe store to updates
    handleStoreSubscribe(store);
  });
});
