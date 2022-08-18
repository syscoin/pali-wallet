import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';

import { popupPromise } from './popup-promise';

/**
 * Handles methods request.
 *
 * Methods have a prefix and a name. Prefixes are the destination of the
 * request. Supported: sys, eth, wallet
 *
 * @return The method return
 */
export const methodRequest = async (
  host: string,
  data: { args?: any[]; method: string; network?: string }
) => {
  const { dapp, wallet } = window.controller;

  const [prefix, methodName] = data.method.split('_');

  //* Wallet methods
  if (prefix === 'wallet') {
    switch (methodName) {
      case 'isConnected':
        return dapp.isConnected(host);
      case 'isLocked':
        return !wallet.isUnlocked();
      case 'changeAccount':
        return popupPromise({
          host,
          route: 'change-account',
          eventName: 'accountChange',
          data: { network: data.network },
        });
      default:
        throw new Error('Unknown method');
    }
  }

  if (!dapp.isConnected(host))
    throw new Error('Restricted method. Connect before requesting');

  //* Providers methods
  const provider = prefix === 'sys' ? SysProvider(host) : EthProvider(host);
  const method = provider[methodName];

  if (!method) throw new Error('Unknown method');

  if (data.args) return await method(...data.args);

  return await method();
};
