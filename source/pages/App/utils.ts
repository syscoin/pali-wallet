import { Store } from 'webext-redux';

import { STORE_PORT } from 'constants/index';

class PaliStore extends Store {
  [x: string]: any;
  constructor(portName?: string) {
    super({ portName });
  }

  public setPort(portName: string) {
    if (!this.port) {
      this.port = this.browserAPI.runtime.connect(undefined, {
        name: portName,
      });
    } else {
      console.log('port already set');
    }
  }

  public getPort() {
    return this.port;
  }
}

export const paliStore = new PaliStore(STORE_PORT);
