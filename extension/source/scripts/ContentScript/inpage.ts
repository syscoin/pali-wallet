import MasterController from '../Background/controllers/index';

declare global {
  interface Window {
    ConnectionsController: Readonly<IConnectionsController>;
  }
}

if (!window.ConnectionsController) {
  window.ConnectionsController = MasterController().connections;
}

window.dispatchEvent(new CustomEvent('SyscoinStatus', { detail: { SyscoinInstalled: true, ConnectionsController: true } }));
