import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
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

  const [prefix, methodName] = data.method.split('_');
  console.log('Checking prefix and methodName', prefix, methodName);
  if (prefix === 'wallet' && methodName === 'isConnected')
    return dapp.isConnected(host);

  if (data.method) {
    const provider = EthProvider(host);
    const resp = await provider.unrestrictedRPCMethods(
      data.method,
      data.params,
      data.network
    );
    if (resp !== false && resp !== undefined && resp !== null) {
      console.log('Method is not restrictive');
      return resp; //Sending back to Dapp non restrictive method response
    }
  }
  const account = dapp.getAccount(host);

  const isRequestAllowed = dapp.isConnected(host) && account;
  if (prefix === 'eth' && methodName === 'requestAccounts') {
    console.log('Requisting to get eth accounts and connect wallet');
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

  console.log('Check data:', host);
  console.log('data:', data);
  //* Wallet methods
  if (prefix === 'wallet') {
    console.log('methodName', methodName);
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
          eventName: 'accountChange',
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
  } else {
    const provider = SysProvider(host);
    const method = provider[methodName];
    if (!method) throw new Error('Unknown method');

    if (data.params) return await method(...data.params);
    console.log('Almost returning');
    return await method();
  }
};

export const enable = async (host: string, chain: string, chainId: number) => {
  console.log('trying to connect pali to dapp');
  const { dapp } = window.controller;
  console.log('trying to connect pali to dapp', dapp.isConnected(host));
  if (dapp.isConnected(host)) return [dapp.getAccount(host).address];

  const acceptedRequest: any = await popupPromise({
    host,
    route: 'connect-wallet',
    eventName: 'connect',
    data: { chain, chainId },
  });
  if (!acceptedRequest)
    throw new Error('Restricted method. Connect before requesting');
  console.log('AcceptedRequest data', acceptedRequest);
  return [acceptedRequest.connectedAccount.address];
};
