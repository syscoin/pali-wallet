import React from 'react';
import { transitions, positions, Provider as AlertProvider } from 'react-alert';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import watch from 'redux-watch';
import { Store } from 'webext-redux';

import { ToastAlert } from 'components/index';
import { STORE_PORT } from 'constants/index';
import appStore from 'state/store';
import 'assets/styles/index.css';
import 'assets/styles/custom-input-password.css';
import 'assets/styles/custom-input-search.css';
import 'assets/styles/custom-input-normal.css';
import 'assets/styles/custom-checkbox.css';
import 'assets/styles/custom-form-inputs-styles.css';
import 'assets/styles/custom-autolock-input.css';
import 'assets/styles/custom-receive-input.css';
import 'assets/styles/custom-import-token-input.css';
import 'assets/fonts/index.css';
import 'assets/styles/custom-send-utxo-input.css';
import { log } from 'utils/index';

import External from './External';

const app = document.getElementById('external-root');
const store = new Store({ portName: STORE_PORT });

const w = watch(appStore.getState, 'vault.lastLogin');
store.subscribe(
  w(() => {
    log('watching webext store');
  })
);

const options = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};

store.ready().then(() => {
  ReactDOM.render(
    <Provider store={store}>
      <AlertProvider template={ToastAlert} {...options}>
        <External />
      </AlertProvider>
    </Provider>,
    app
  );
});
