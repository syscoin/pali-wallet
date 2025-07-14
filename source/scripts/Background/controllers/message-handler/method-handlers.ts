import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';
import { networkChain } from 'utils/network';

import { popupPromise } from './popup-promise';
import { requestCoordinator } from './request-pipeline';
import { IEnhancedRequestContext, MethodHandlerType } from './types';

// Cache for provider state methods
interface IProviderStateCache {
  [key: string]: { timestamp: number; value: any };
}

const providerStateCache: IProviderStateCache = {};

// Clear cache function
export function clearProviderCache() {
  Object.keys(providerStateCache).forEach((key) => {
    delete providerStateCache[key];
  });
}

// Base interface for method handlers
export interface IMethodHandler {
  canHandle(context: IEnhancedRequestContext): boolean;
  handle(context: IEnhancedRequestContext): Promise<any>;
}

// Generic method executor that uses registry configuration
async function executeMethodWithCache(
  context: IEnhancedRequestContext,
  executor: () => Promise<any>
): Promise<any> {
  const { methodConfig } = context;

  // Check if method has caching enabled
  if (methodConfig.cacheKey && methodConfig.cacheTTL) {
    const now = Date.now();
    const cached = providerStateCache[methodConfig.cacheKey];

    if (cached && now - cached.timestamp < methodConfig.cacheTTL) {
      return cached.value;
    }

    // Execute and cache the result
    const result = await executor();
    providerStateCache[methodConfig.cacheKey] = {
      value: result,
      timestamp: now,
    };
    return result;
  }

  // No caching, just execute
  return executor();
}

// Check if method requires active account
function validateActiveAccount(context: IEnhancedRequestContext, account: any) {
  if (context.methodConfig.requiresActiveAccount && !account) {
    throw cleanErrorStack(ethErrors.provider.unauthorized('Not connected'));
  }
}

// Wallet method handlers
export class WalletMethodHandler implements IMethodHandler {
  canHandle(context: IEnhancedRequestContext): boolean {
    return context.methodConfig.handlerType === MethodHandlerType.Wallet;
  }

  async handle(context: IEnhancedRequestContext): Promise<any> {
    const { originalRequest, methodConfig } = context;
    const { host, method, params } = originalRequest;
    const methodName = method.split('_')[1] || method;

    const { dapp, wallet } = getController();
    const { vault, vaultGlobal } = store.getState();
    const { activeAccount, activeNetwork, isBitcoinBased, accountAssets } =
      vault;
    const { networks } = vaultGlobal;
    const account = dapp.getAccount(host);

    // Validate active account if required
    validateActiveAccount(context, account);

    // Handle network switching methods
    if (methodName === 'switchEthereumChain') {
      if (!params?.[0]?.chainId) {
        throw cleanErrorStack(
          ethErrors.rpc.invalidParams('chainId is required')
        );
      }

      const targetChainId = Number(params[0].chainId);

      if (activeNetwork.chainId === targetChainId) {
        return null; // Already on the correct chain
      }

      if (!networks.ethereum[targetChainId]) {
        throw ethErrors.provider.custom({
          code: 4902,
          message:
            'Chain not found. Please add it first using wallet_addEthereumChain.',
        });
      }

      return requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host,
            route: methodConfig.popupRoute!,
            eventName: methodConfig.popupEventName!,
            data: { chainId: targetChainId },
          }),
        methodConfig.popupRoute! // Explicit route parameter
      );
    }

    if (methodName === 'changeUTXOEVM') {
      const prefix = params?.[0]?.prefix;

      const validatePrefixAndCurrentChain =
        (prefix?.toLowerCase() === 'sys' && !isBitcoinBased) ||
        (prefix?.toLowerCase() === 'eth' && isBitcoinBased);

      if (!validatePrefixAndCurrentChain) {
        throw cleanErrorStack(
          ethErrors.provider.unauthorized(
            'changeUTXOEVM requires correct network type and prefix'
          )
        );
      }

      if (!params?.[0]?.chainId) {
        throw cleanErrorStack(ethErrors.rpc.invalidParams('chainId required'));
      }

      const { chainId } = params[0];
      const newChainValue =
        prefix?.toLowerCase() === 'sys' ? 'syscoin' : 'ethereum';
      const targetNetwork = networks[newChainValue.toLowerCase()][chainId];

      if (!targetNetwork) {
        throw cleanErrorStack(
          ethErrors.provider.unauthorized('Network does not exist')
        );
      }

      return requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host,
            route: methodConfig.popupRoute!,
            eventName: methodConfig.popupEventName!,
            data: {
              newNetwork: targetNetwork,
              newChainValue: newChainValue,
            },
          }),
        methodConfig.popupRoute! // Explicit route parameter
      );
    }

    // Handle popup-based methods using registry configuration
    if (
      methodConfig.hasPopup &&
      methodConfig.popupRoute &&
      methodConfig.popupEventName
    ) {
      const popupData = this.getPopupData(methodName, params);
      return requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host,
            route: methodConfig.popupRoute,
            eventName: methodConfig.popupEventName,
            data: popupData,
          }),
        methodConfig.popupRoute! // Explicit route parameter
      );
    }

    // Handle non-popup methods
    return executeMethodWithCache(context, async () => {
      switch (methodName) {
        case 'isLocked':
          return !wallet.isUnlocked();

        case 'isConnected':
          return dapp.isConnected(host);

        case 'getChangeAddress':
          return wallet.getChangeAddress(account.id);

        case 'getAccount':
          return account || null;

        case 'getBalance':
          return account.balances[networkChain()];

        case 'getNetwork':
          return dapp.getNetwork();

        case 'getPublicKey':
          return account.xpub;

        case 'getAddress':
          return account.address;

        case 'getTokens':
          return accountAssets[activeAccount.type]?.[activeAccount.id];

        case 'estimateFee':
          return wallet.getRecommendedFee();

        case 'getPermissions':
          return [
            {
              caveats: [{ type: 'restrictReturnedAccounts', value: [account] }],
              date: dapp.get(host).date,
              invoker: host,
              parentCapability: 'eth_accounts',
            },
          ];

        case 'getProviderState':
          return {
            accounts: account ? [account.address] : [],
            chainId: `0x${activeNetwork.chainId.toString(16)}`,
            isUnlocked: wallet.isUnlocked(),
            networkVersion: activeNetwork.chainId,
            isBitcoinBased,
          };

        case 'getSysProviderState':
          return {
            xpub: account?.xpub || null,
            blockExplorerURL: isBitcoinBased ? activeNetwork.url : null,
            isUnlocked: wallet.isUnlocked(),
            isBitcoinBased,
          };

        case 'getSysAssetMetadata':
          if (!params || params.length < 2) {
            throw cleanErrorStack(
              ethErrors.rpc.invalidParams(
                'getSysAssetMetadata requires assetGuid and networkUrl parameters'
              )
            );
          }
          return wallet.getSysAssetMetadata(params[0], params[1]);

        default:
          throw cleanErrorStack(ethErrors.rpc.methodNotFound());
      }
    });
  }

  private getPopupData(methodName: string, params: any[]): any {
    switch (methodName) {
      case 'changeAccount':
        return { network: params?.[0] };
      case 'requestPermissions':
        return { params };
      case 'watchAsset':
        return { asset: params?.[0] || null };
      case 'addEthereumChain':
        return { chainConfig: params?.[0] };
      default:
        return {};
    }
  }
}

// Special handler for internal methods
export class InternalMethodHandler implements IMethodHandler {
  canHandle(context: IEnhancedRequestContext): boolean {
    return context.methodConfig.handlerType === MethodHandlerType.Internal;
  }

  async handle(): Promise<any> {
    // Internal methods (ENABLE, DISABLE, etc.) are handled in the message handler
    // This handler exists for completeness but shouldn't be called
    throw cleanErrorStack(ethErrors.rpc.methodNotFound());
  }
}

// Ethereum method handlers
export class EthMethodHandler implements IMethodHandler {
  canHandle(context: IEnhancedRequestContext): boolean {
    return context.methodConfig.handlerType === MethodHandlerType.Eth;
  }

  async handle(context: IEnhancedRequestContext): Promise<any> {
    const { originalRequest, methodConfig } = context;
    const { host, method, params } = originalRequest;
    const methodName = method.split('_')[1] || method;

    const { dapp, wallet } = getController();
    const { vault } = store.getState();
    const { activeNetwork } = vault;

    // Handle special cached methods
    if (methodConfig.cacheKey) {
      return executeMethodWithCache(context, async () => {
        switch (methodName) {
          case 'chainId':
            return `0x${activeNetwork.chainId.toString(16)}`;
          case 'accounts':
            const account = dapp.getAccount(host);
            return wallet.isUnlocked() && account ? [account.address] : [];
          case 'version': // net_version
            return activeNetwork.chainId.toString();
          default:
            // Fall through to provider methods
            break;
        }
      });
    }

    // Handle requestAccounts - connection middleware ensures we're connected
    if (methodName === 'requestAccounts') {
      const account = dapp.getAccount(host);
      if (!account) {
        throw cleanErrorStack(ethErrors.provider.unauthorized('Not connected'));
      }
      return [account.address];
    }

    // Get the provider
    const provider = EthProvider(host);

    // Try unrestricted methods first
    const unrestrictedResult = await provider.unrestrictedRPCMethods(
      method,
      params
    );
    if (unrestrictedResult !== false && unrestrictedResult !== undefined) {
      return unrestrictedResult;
    }

    // Then try restricted methods
    const restrictedResult = await provider.restrictedRPCMethods(
      method,
      params
    );
    if (restrictedResult === false || restrictedResult === undefined) {
      throw cleanErrorStack(ethErrors.rpc.methodNotFound());
    }

    return restrictedResult;
  }
}

// Syscoin method handlers
export class SysMethodHandler implements IMethodHandler {
  canHandle(context: IEnhancedRequestContext): boolean {
    return context.methodConfig.handlerType === MethodHandlerType.Sys;
  }

  async handle(context: IEnhancedRequestContext): Promise<any> {
    const { originalRequest } = context;
    const { host, method, params } = originalRequest;
    const methodName = method.split('_')[1] || method;

    // Handle requestAccounts - connection middleware ensures we're connected
    if (methodName === 'requestAccounts') {
      const { dapp } = getController();
      const account = dapp.getAccount(host);
      if (!account) {
        throw cleanErrorStack(ethErrors.provider.unauthorized('Not connected'));
      }
      // For sys_requestAccounts, return address (consistent with eth_requestAccounts)
      // Note: Bridge can get full account details via wallet_getAccount if needed
      return [account.address];
    }

    // Get the provider
    const provider = SysProvider(host);

    // Use the provider methods directly
    const providerMethod = provider[methodName];
    if (!providerMethod || typeof providerMethod !== 'function') {
      throw cleanErrorStack(ethErrors.rpc.methodNotFound());
    }

    // Execute the method
    if (params && params.length > 0) {
      return await providerMethod(...params);
    }
    return await providerMethod();
  }
}

// Create a composite handler
export class CompositeMethodHandler implements IMethodHandler {
  private handlers: IMethodHandler[] = [];

  addHandler(handler: IMethodHandler): CompositeMethodHandler {
    this.handlers.push(handler);
    return this;
  }

  canHandle(context: IEnhancedRequestContext): boolean {
    return this.handlers.some((h) => h.canHandle(context));
  }

  async handle(context: IEnhancedRequestContext): Promise<any> {
    const handler = this.handlers.find((h) => h.canHandle(context));
    if (!handler) {
      throw cleanErrorStack(ethErrors.rpc.methodNotFound());
    }
    return handler.handle(context);
  }
}

// Create the default method handler
export function createDefaultMethodHandler(): CompositeMethodHandler {
  return new CompositeMethodHandler()
    .addHandler(new InternalMethodHandler())
    .addHandler(new WalletMethodHandler())
    .addHandler(new EthMethodHandler())
    .addHandler(new SysMethodHandler());
}
