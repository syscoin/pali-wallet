import store from 'state/store';

export interface IConnectionsController {
  getWalletState: () => any;
}

const ConnectionsController = (): IConnectionsController => {
  const getWalletState = () => {
    return store.getState().wallet;
  }

  return {
    getWalletState
  }
};

export default ConnectionsController;
