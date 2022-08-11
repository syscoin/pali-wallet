import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import store from 'state/store';
import { isActiveNetwork } from 'utils/network';

import { popupPromise } from './popup-promise';

const _changeNetwork = async (chain: string, chainId: number) => {
  console.log('[DApp] Changing pali network');

  const { networks } = store.getState().vault;
  const network = networks[chain][chainId];

  const { wallet, refresh } = window.controller;
  await wallet.setActiveNetwork(network);
  await refresh(true);
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

  const { chain, chainId } = dapp.get(host);
  if (!isActiveNetwork(chain, chainId)) {
    await _changeNetwork(chain, chainId);
  }

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

export const enable = async (host: string, chain: string, chainId: number) => {
  const { dapp } = window.controller;
  if (dapp.isConnected(host)) return { success: true };

  return popupPromise({
    host,
    route: 'connect-wallet',
    eventName: 'connect',
    data: { chain, chainId },
  });
};
