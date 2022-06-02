import { STORE_PORT } from 'constants/index';

import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { Store } from 'webext-redux';
import watch from 'redux-watch';
import { transitions, positions, Provider as AlertProvider } from 'react-alert';
import { ToastAlert } from 'components/index';
import appStore from 'state/store';
import 'assets/styles/tailwind.css';
import 'assets/fonts/index.css';
import { log } from 'utils/index';

import Options from './Options';

const optionsPage = document.getElementById('options-root');
const store = new Store({ portName: STORE_PORT });

const w = watch(appStore.getState, 'wallet.status');
store.subscribe(
  w(() => {
    log('watching webext store');
  })
);

const styleOptions = {
  position: positions.BOTTOM_CENTER,
  timeout: 2 * 1000,
  offset: '30px',
  transition: transitions.FADE,
};

store.ready().then(() => {
  ReactDOM.render(
    <Provider store={store}>
      <AlertProvider template={ToastAlert} {...styleOptions}>
        <Options />
      </AlertProvider>
    </Provider>,
    optionsPage
  );
});
