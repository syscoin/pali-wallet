import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import store from 'state/store';
import { getController } from 'utils/browser';
import { networkChain } from 'utils/network';

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
  data: { method: string; network?: string; params?: any[] }
) => {
  const { dapp, wallet } = window.controller;
  const controller = getController();

  const [prefix, methodName] = data.method.split('_');

  if (prefix === 'wallet' && methodName === 'isConnected')
    return dapp.isConnected(host);

  if (data.method) {
    const provider = EthProvider(host);
    const resp = await provider.unrestrictedRPCMethods(
      data.method,
      data.params
    );
    if (resp !== false && resp !== undefined && resp !== null) {
      return resp; //Sending back to Dapp non restrictive method response
    }
  }
  const account = dapp.getAccount(host);

  const isRequestAllowed = dapp.isConnected(host) && account;
  if (prefix === 'eth' && methodName === 'requestAccounts') {
    return await enable(host, undefined, undefined);
    // if (!acceptedRequest)
    //   throw new Error('Restricted method. Connect before requesting');
    // console.log('AcceptedRequest data', acceptedRequest);
    // return acceptedRequest.connectedAccount.address;
  }

  if (!isRequestAllowed)
    throw new Error('Restricted method. Connect before requesting');
  const estimateFee = () => wallet.getRecommendedFee(dapp.getNetwork().url);

  if (prefix === 'eth' && methodName === 'accounts')
    return [dapp.getAccount(host).address];

  //* Wallet methods
  if (prefix === 'wallet') {
    let tryingToAdd = false;
    const { activeNetwork, networks: chains } = store.getState().vault;
    switch (methodName) {
      case 'isLocked':
        return !wallet.isUnlocked();
      case 'getAccount':
        return account;
      case 'getBalance':
        return Boolean(account) && account.balances[networkChain()];
      case 'getNetwork':
        return dapp.getNetwork();
      case 'getPublicKey':
        return account.xpub;
      case 'getAddress':
        return account.address;
      case 'getTokens':
        return account.assets;
      case 'estimateFee':
        return estimateFee();
      case 'changeAccount':
        return popupPromise({
          host,
          route: 'change-account',
          eventName: 'accountsChanged',
          data: { network: data.network },
        });
      case 'requestPermissions':
        return popupPromise({
          host,
          route: 'change-account',
          eventName: 'requestPermissions',
          data: { params: data.params },
        });
      case 'getPermissions':
        //This implementation should be improved to integrate in a more appropriate way the EIP2255
        const response: any = [{}];
        response[0].caveats = [
          { type: 'restrictReturnedAccounts', value: [dapp.getAccount(host)] },
        ];
        response[0].date = dapp.get(host).date;
        response[0].invoker = host;
        response[0].parentCapability = 'eth_accounts';

        return response;
      case 'addEthereumChain':
        const customRPCData = {
          url: data.params[0].rpcUrls[0],
          chainId: Number(data.params[0].chainId),
          label: data.params[0].chainName,
          apiUrl: undefined,
          isSyscoinRpc: false,
        };
        const network = await controller.wallet.getRpc(customRPCData);
        if (data.params[0].blockExplorerUrls) {
          customRPCData.apiUrl = data.params[0].blockExplorerUrls;
        }
        if (!chains.ethereum[customRPCData.chainId]) {
          return popupPromise({
            host,
            route: 'add-EthChain',
            eventName: 'wallet_addEthereumChain',
            data: { ...customRPCData, symbol: network?.currency },
          });
        }
        tryingToAdd = true;
      case 'switchEthereumChain':
        const chainId = tryingToAdd
          ? customRPCData.chainId
          : Number(data.params[0].chainId);

        if (activeNetwork.chainId === chainId) return null;
        else if (chains.ethereum[chainId]) {
          return popupPromise({
            host,
            route: 'switch-EthChain',
            eventName: 'wallet_switchEthereumChain',
            data: { chainId: chainId },
          });
        }
        return {
          code: -32603,
          message: `Unrecognized chain ID 0x${chainId.toString(
            16
          )}. Try adding the chain using wallet_addEthereumChain first.`,
        };

      default:
        throw new Error('Unknown method');
    }
  }

  //* Providers methods
  if (prefix !== 'sys') {
    const provider = EthProvider(host);
    const resp = await provider.restrictedRPCMethods(data.method, data.params);

    if (!resp) throw new Error('Failure on RPC request');

    return resp;
  }

  const provider = SysProvider(host);
  const method = provider[methodName];

  if (!method) throw new Error('Unknown method');

  if (data.params) return await method(...data.params);

  return await method();
};

export const enable = async (host: string, chain: string, chainId: number) => {
  const { dapp } = window.controller;

  if (dapp.isConnected(host)) return [dapp.getAccount(host).address];

  const acceptedRequest: any = await popupPromise({
    host,
    route: 'connect-wallet',
    eventName: 'connect',
    data: { chain, chainId },
  });

  if (!acceptedRequest)
    throw new Error('Restricted method. Connect before requesting');

  return [acceptedRequest.connectedAccount.address];
};
