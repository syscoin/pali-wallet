import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import store from 'state/store';

import { popupPromise } from './popup-promise';

/**
 * Checks if the current pali network matches the params.
 * If it doesn't, change to specified network
 */
const _checkAndChangeNetwork = async (chain: string, chainId: number) => {
  const { wallet } = window.controller;
  const {
    vault: { activeNetwork, networks },
  } = store.getState();
  const isSysCore = activeNetwork.url.includes('blockbook');
  const activeChain = isSysCore ? 'syscoin' : 'ethereum';

  const isSameChain = chain === activeChain;
  const isSameChainId = activeNetwork.chainId === chainId;

  if (isSameChain && isSameChainId) return;

  const network = networks[chain][chainId];
  await wallet.setActiveNetwork(network);
};

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
  const { dapp } = window.controller;

  const [prefix, methodName] = data.method.split('_');

  //* Wallet methods
  if (prefix === 'wallet') {
    switch (methodName) {
      case 'isConnected':
        return dapp.isConnected(host);
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

export const enable = async (host: string, data: any) => {
  const { dapp } = window.controller;
  if (dapp.isConnected(host)) return { success: true };

  const { chain, chainId } = data;
  return popupPromise({
    host,
    route: 'connect-wallet',
    eventName: 'connect',
    data: { chain, chainId },
  });
};
