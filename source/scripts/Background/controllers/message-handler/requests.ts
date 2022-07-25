import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';

import { changeAccount } from './change-account';
import { Message } from './types';

/**
 * Handles methods request.
 *
 * Methods have a prefix and a name. Prefixes are the destination of the
 * request. Supported: sys, eth, wallet
 *
 * @return The method return
 */
export const methodRequest = async (
  message: Message,
  origin: string,
  setPendingWindow: (isPending: boolean) => void,
  isPendingWindow: () => boolean
) => {
  const { dapp } = window.controller;

  const [prefix, methodName] = message.data.method.split('_');

  //* Wallet methods
  if (prefix === 'wallet') {
    switch (methodName) {
      case 'isConnected':
        return dapp.isConnected(origin);
      case 'changeAccount':
        return changeAccount(
          message.data.network,
          origin,
          isPendingWindow,
          setPendingWindow
        );
      default:
        throw new Error('Unknown method');
    }
  }

  //* Providers methods
  const provider = prefix === 'sys' ? SysProvider(origin) : EthProvider(origin);
  const method = provider[methodName];

  if (!method) throw new Error('Unknown method');

  if (message.data.args) return await method(...message.data.args);

  return await method();
};
