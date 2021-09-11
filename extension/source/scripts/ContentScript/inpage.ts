import MasterController from '../Background/controllers/index';
import 'ses';
declare global {
  interface Window {
    ConnectionsController: Readonly<IConnectionsController>;
  }
}

if (!window.ConnectionsController) {
  lockdown();
  window.ConnectionsController = MasterController().connections;
}

window.dispatchEvent(new CustomEvent('SyscoinStatus', { detail: { SyscoinInstalled: true, ConnectionsController: true } }));
