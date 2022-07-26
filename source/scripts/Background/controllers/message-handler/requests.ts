import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';

import { changeAccount } from './change-account';

/**
 * Handles methods request.
 *
 * Methods have a prefix and a name. Prefixes are the destination of the
 * request. Supported: sys, eth, wallet
 *
 * @return The method return
 */
export const methodRequest = async (
  origin: string,
  data: { args?: any[]; method: string; network?: string }
) => {
  const { dapp } = window.controller;

  const [prefix, methodName] = data.method.split('_');

  //* Wallet methods
  if (prefix === 'wallet') {
    switch (methodName) {
      case 'isConnected':
        return dapp.isConnected(origin);
      case 'changeAccount':
        return changeAccount(data.network, origin);
      default:
        throw new Error('Unknown method');
    }
  }

  //* Providers methods
  const provider = prefix === 'sys' ? SysProvider(origin) : EthProvider(origin);
  const method = provider[methodName];

  if (!method) throw new Error('Unknown method');

  if (data.args) return await method(...data.args);

  return await method();
};
