import { isHexString } from '@ethersproject/bytes';
import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';
import { networkChain } from 'utils/network';

import { popupPromise } from './popup-promise';
import { requestCoordinator } from './request-pipeline';
import {
  generateWalletBundleId,
  isValidAppProvidedBundleId,
  releaseSendCallsBundleReservation,
  reserveSendCallsBundle,
  resolveCallsStatus,
} from './sendCallsBundles';
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
    const state = store.getState();

    // Special handling for provider initialization methods
    const isProviderInitMethod = [
      'getProviderState',
      'getSysProviderState',
    ].includes(methodName);

    // Safety check for vault state initialization
    if (!state.vault || !state.vaultGlobal) {
      if (!isProviderInitMethod) {
        throw cleanErrorStack(
          new Error(
            'Vault state not initialized. Please try again in a moment.'
          )
        );
      }
      // For provider init methods, we'll handle this gracefully in the switch cases
    }

    const { vault, vaultGlobal } = state;
    // Don't destructure these variables if vault is not initialized
    let activeAccount, activeNetwork, isBitcoinBased, accountAssets, networks;

    if (vault) {
      ({ activeAccount, activeNetwork, isBitcoinBased, accountAssets } = vault);
    }

    if (vaultGlobal) {
      ({ networks } = vaultGlobal);
    }

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
    // Handle popup-based methods using registry configuration
    if (
      methodConfig.hasPopup &&
      methodConfig.popupRoute &&
      methodConfig.popupEventName
    ) {
      if (methodName === 'sendCalls') {
        const sendCallsRequest = params?.[0] || {};
        const smartAccountAtomicSupported =
          account?.isSmartAccount &&
          account.smartAccount?.chainId === activeNetwork?.chainId;

        if (
          sendCallsRequest.atomicRequired === true &&
          !smartAccountAtomicSupported
        ) {
          throw cleanErrorStack(
            ethErrors.provider.custom({
              code: 5700,
              message:
                'Atomic wallet_sendCalls requires an active smart account on the selected chain.',
            })
          );
        }

        // EIP-5792: when the dapp supplies its own bundle id the wallet must
        // respect it, return it, and reject duplicates (error 5720).
        if (
          sendCallsRequest.id !== undefined &&
          !isValidAppProvidedBundleId(sendCallsRequest.id)
        ) {
          throw cleanErrorStack(
            ethErrors.rpc.invalidParams(
              'wallet_sendCalls id must be a 0x-prefixed hex string of at most 4096 bytes.'
            )
          );
        }

        // Reserve the bundle id atomically before opening the approval popup
        // so concurrent wallet_sendCalls requests reusing the same id are
        // rejected (5720) instead of racing the post-broadcast record.
        const bundleId: string =
          sendCallsRequest.id ?? generateWalletBundleId();
        const reserved = await reserveSendCallsBundle(host, bundleId, {
          atomic:
            Boolean(smartAccountAtomicSupported) ||
            sendCallsRequest.atomicRequired === true,
          chainId: activeNetwork?.chainId,
          smartAccount: Boolean(smartAccountAtomicSupported),
        });
        if (!reserved) {
          throw cleanErrorStack(
            ethErrors.provider.custom({
              code: 5720,
              message:
                'There is already a bundle submitted with this id (Duplicate ID).',
            })
          );
        }

        try {
          return await requestCoordinator.coordinatePopupRequest(
            context,
            () =>
              popupPromise({
                host,
                route: methodConfig.popupRoute,
                eventName: methodConfig.popupEventName,
                data: { ...sendCallsRequest, bundleId },
              }),
            methodConfig.popupRoute! // Explicit route parameter
          );
        } catch (error) {
          // The request never broadcast (rejected/failed): free the id so the
          // dapp can retry with it. Finalized bundles are never deleted here.
          await releaseSendCallsBundleReservation(host, bundleId);
          throw error;
        }
      }

      // EIP-5792 wallet_showCallsStatus: validate the bundle id (5730 for
      // unknown ids), then show a read-only status popup. The method itself
      // returns nothing for known ids.
      if (methodName === 'showCallsStatus') {
        if (!params || params.length < 1 || typeof params[0] !== 'string') {
          throw cleanErrorStack(
            ethErrors.rpc.invalidParams(
              'showCallsStatus requires a call bundle ID'
            )
          );
        }
        const callsStatus = await resolveCallsStatus(
          (bundleChainId: number) =>
            wallet?.getEvmProviderForChain(bundleChainId) ?? null,
          host,
          params[0]
        );
        return requestCoordinator
          .coordinatePopupRequest(
            context,
            () =>
              popupPromise({
                host,
                route: methodConfig.popupRoute,
                eventName: methodConfig.popupEventName,
                data: { callsStatus },
              }),
            methodConfig.popupRoute! // Explicit route parameter
          )
          .then(() => null);
      }

      const popupData = this.getPopupData(methodName, params, host);
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
      // Shared temp holder for provider accounts across provider-state cases
      let providerAccounts: string[] = [];
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
          if (!activeAccount || !accountAssets) {
            return [];
          }
          return accountAssets[activeAccount.type]?.[activeAccount.id] || [];

        case 'estimateFee':
          return wallet.getRecommendedFee();

        case 'getPermissions':
          // Check if dapp is actually connected
          const dappInfo = dapp.get(host);
          if (!dappInfo) {
            // No permissions if not connected
            return [];
          }

          // Get the current network info
          const network = dapp.getNetwork();

          const permissions = [
            {
              id: '1', // Add id field that test dapp expects
              parentCapability: 'eth_accounts',
              invoker: host,
              caveats: [
                {
                  type: 'restrictReturnedAccounts',
                  value: [account.address], // Ensure we return address, not full account object
                },
              ],
              date: dappInfo.date,
            },
          ];

          // Add endowment:permitted-chains permission for EVM networks
          if (vault && !vault.isBitcoinBased) {
            permissions.push({
              id: '2',
              parentCapability: 'endowment:permitted-chains',
              invoker: host,
              caveats: [
                {
                  type: 'restrictNetworkSwitching',
                  value: [`0x${network.chainId.toString(16)}`], // Convert to hex format
                },
              ],
              date: dappInfo.date,
            });
          }

          return permissions;

        case 'revokePermissions':
          // Check params to see which permissions to revoke
          // params[0] should be an object with permission names as keys
          // e.g., { eth_accounts: {} } to revoke account access
          const permissionsToRevoke = params?.[0] || {};

          // For now, any revocation request will disconnect the dapp entirely
          // This matches the current behavior but avoids reconnection loops
          if (Object.keys(permissionsToRevoke).length > 0) {
            await dapp.disconnect(host);
          }

          // Return null per EIP-2255 spec
          return null;

        case 'getProviderState':
          // Special handling for provider initialization
          if (!vault || isBitcoinBased === undefined || !activeNetwork) {
            // Return safe defaults during initialization
            return {
              accounts: [],
              chainId: '0x39', // Default to Syscoin mainnet
              isUnlocked: false,
              networkVersion: 57,
              isBitcoinBased: false, // Default for Ethereum provider
            };
          }

          // Return accounts if wallet is unlocked, similar to eth_accounts
          providerAccounts = [];
          if (wallet.isUnlocked() && !isBitcoinBased) {
            // First check if dapp is already connected
            if (account) {
              providerAccounts = [account.address];
            } else {
              // If not connected but wallet is unlocked, return the active account
              const vaultAccounts = store.getState().vault?.accounts;
              const vaultActiveAccount = store.getState().vault?.activeAccount;
              if (vaultAccounts && vaultActiveAccount) {
                const activeAccountData =
                  vaultAccounts[vaultActiveAccount.type]?.[
                    vaultActiveAccount.id
                  ];
                if (activeAccountData?.address) {
                  providerAccounts = [activeAccountData.address];
                }
              }
            }
          }

          return {
            accounts: providerAccounts,
            chainId: `0x${activeNetwork.chainId.toString(16)}`,
            isUnlocked: wallet.isUnlocked(),
            networkVersion: activeNetwork.chainId,
            isBitcoinBased,
          };

        case 'getSysProviderState':
          // Special handling for provider initialization
          // This method is called very early when the page loads
          if (!vault || isBitcoinBased === undefined || !activeNetwork) {
            // Return safe defaults during initialization
            return {
              accounts: [],
              xpub: null,
              blockExplorerURL: null,
              isUnlocked: false,
              isBitcoinBased: true, // Default to true for Syscoin provider
            };
          }
          // Return accounts if wallet is unlocked, similar to eth_accounts
          providerAccounts = [];
          if (wallet.isUnlocked() && isBitcoinBased) {
            // First check if dapp is already connected
            if (account) {
              providerAccounts = [account.address];
            } else {
              // If not connected but wallet is unlocked, return the active account
              const vaultAccounts = store.getState().vault?.accounts;
              const vaultActiveAccount = store.getState().vault?.activeAccount;
              if (vaultAccounts && vaultActiveAccount) {
                const activeAccountData =
                  vaultAccounts[vaultActiveAccount.type]?.[
                    vaultActiveAccount.id
                  ];
                if (activeAccountData?.address) {
                  providerAccounts = [activeAccountData.address];
                }
              }
            }
          }
          return {
            accounts: providerAccounts,
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

        case 'getSysTransactionFromBlockbook':
          if (!params || params.length < 2) {
            throw cleanErrorStack(
              ethErrors.rpc.invalidParams(
                'getSysTransactionFromBlockbook requires txid and networkUrl parameters'
              )
            );
          }
          return wallet.getSysTransactionFromBlockbook(params[0], params[1]);

        case 'getSmartAccountModules': {
          // Read-only module inventory for the connected smart account.
          if (!account?.isSmartAccount || !account.smartAccount) {
            throw cleanErrorStack(
              ethErrors.rpc.invalidRequest(
                'The connected account is not a smart account'
              )
            );
          }
          const smartAccountMetadata = account.smartAccount;
          if (smartAccountMetadata.chainId !== activeNetwork.chainId) {
            throw cleanErrorStack(
              ethErrors.rpc.invalidRequest(
                `Smart account modules are only available on chain ${smartAccountMetadata.chainId}. Switch back from chain ${activeNetwork.chainId} to inspect this account.`
              )
            );
          }
          return {
            address: account.address,
            chainId: `0x${activeNetwork.chainId.toString(16)}`,
            deployed: Boolean(smartAccountMetadata.isDeployed),
            installed: (smartAccountMetadata.installedModules || []).map(
              (module: any) => ({
                address: module.address,
                id: module.id,
                moduleType: module.type === 'validator' ? 1 : 2,
                name: module.id === 'custom' ? module.config?.name : undefined,
              })
            ),
            activeValidator: smartAccountMetadata.auth?.validator || null,
          };
        }

        case 'getCallsStatus':
          if (!params || params.length < 1 || typeof params[0] !== 'string') {
            throw cleanErrorStack(
              ethErrors.rpc.invalidParams(
                'getCallsStatus requires a call bundle ID'
              )
            );
          }

          return resolveCallsStatus(
            (bundleChainId: number) =>
              wallet?.getEvmProviderForChain(bundleChainId) ?? null,
            host,
            params[0]
          );

        case 'getCapabilities':
          // Smart accounts execute wallet_sendCalls as a single ERC-7579 batch,
          // while regular EOAs are still submitted sequentially.
          const chainId = `0x${activeNetwork.chainId.toString(16)}`;
          const smartAccountAtomicSupported =
            account?.isSmartAccount &&
            account.smartAccount?.chainId === activeNetwork.chainId;
          const capabilities = {
            [chainId]: {
              atomic: {
                status: smartAccountAtomicSupported
                  ? 'supported'
                  : 'unsupported',
              },
            },
          };

          return capabilities;

        default:
          throw cleanErrorStack(ethErrors.rpc.methodNotFound());
      }
    });
  }

  private getPopupData(methodName: string, params: any[], host: string): any {
    // Get current context
    const { dapp } = getController();
    const { vault } = store.getState();
    const { activeAccount, accounts, isBitcoinBased } = vault;

    switch (methodName) {
      case 'changeAccount':
      case 'requestPermissions':
        // For these methods, we need to pass the current account info
        // First try to get the dapp's connected account, fallback to active account
        const dappInfo = dapp.get(host);
        let currentAccountId = dappInfo?.accountId;
        let currentAccountType = dappInfo?.accountType;

        // Validate that the dapp's connected account is valid for current network type
        if (
          currentAccountId !== undefined &&
          currentAccountType !== undefined
        ) {
          const connectedAccount =
            accounts[currentAccountType]?.[currentAccountId];
          if (connectedAccount) {
            const isAccountValid = isBitcoinBased
              ? !isHexString(connectedAccount.address)
              : isHexString(connectedAccount.address);

            if (!isAccountValid) {
              // Dapp's account is invalid for current network type
              // Don't pass it to the popup
              currentAccountId = undefined;
              currentAccountType = undefined;
            }
          }
        }

        return {
          currentAccountId: currentAccountId ?? activeAccount?.id,
          currentAccountType: currentAccountType ?? activeAccount?.type,
          network: params?.[0],
          params,
        };
      case 'watchAsset':
        return { asset: params?.[0] || null };
      case 'addEthereumChain':
        return { chainConfig: params?.[0] };
      case 'prepareSmartAccount':
        return {
          host,
          request: params?.[0] || {},
        };
      case 'requestSmartAccountModuleInstall':
        return {
          action: 'install',
          host,
          module: params?.[0] || {},
        };
      case 'requestSmartAccountModuleUninstall':
        return {
          action: 'uninstall',
          host,
          module: params?.[0] || {},
        };
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
    const { activeNetwork, isBitcoinBased } = vault;

    // Handle special cached methods
    if (methodConfig.cacheKey) {
      return executeMethodWithCache(context, async () => {
        switch (methodName) {
          case 'chainId':
            return `0x${activeNetwork.chainId.toString(16)}`;
          case 'accounts':
            // For eth_accounts, return accounts only if:
            // 1. Wallet is unlocked
            // 2. On EVM network
            // 3. Dapp is connected
            // This matches MetaMask behavior - when locked, return empty array
            if (!wallet.isUnlocked() || isBitcoinBased) {
              return [];
            }

            // Check if dapp is connected
            const connectedAccount = dapp.getAccount(host);
            if (connectedAccount) {
              return [connectedAccount.address.toLowerCase()];
            }

            // Not connected - return empty array
            return [];
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
      return [account.address.toLowerCase()];
    }

    // Handle changeUTXOEVM - already processed by middleware
    if (methodName === 'changeUTXOEVM') {
      // The utxoEvmSwitchMiddleware has already handled the network switch
      // Just return null to indicate success
      return null;
    }

    // Handle popup-based methods using registry configuration
    if (
      methodConfig.hasPopup &&
      methodConfig.popupRoute &&
      methodConfig.popupEventName &&
      methodName !== 'sendTransaction'
    ) {
      // For eth methods, params might be objects or arrays

      return requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host,
            route: methodConfig.popupRoute,
            eventName: methodConfig.popupEventName,
            data: params,
          }),
        methodConfig.popupRoute! // Explicit route parameter
      );
    }

    // Get the provider for non-popup methods
    const provider = EthProvider(host, context);

    // Try unrestricted methods first
    const unrestrictedResult = await provider.unrestrictedRPCMethods(
      method,
      params
    );
    if (unrestrictedResult !== false && unrestrictedResult !== undefined) {
      return unrestrictedResult;
    }

    // Then try restricted methods (only non-popup ones)
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
    const { originalRequest, methodConfig } = context;
    const { host, method, params } = originalRequest;
    const methodName = method.split('_')[1] || method;

    // Handle requestAccounts - get UTXO address from vault state
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

    // Handle changeUTXOEVM - already processed by middleware
    if (methodName === 'changeUTXOEVM') {
      // The utxoEvmSwitchMiddleware has already handled the network switch
      // Just return null to indicate success
      return null;
    }

    // Handle sys_switchChain (UTXO -> UTXO) - processed by middleware opening popup
    if (methodName === 'switchChain') {
      return null;
    }

    // Handle popup-based methods using registry configuration
    if (
      methodConfig.hasPopup &&
      methodConfig.popupRoute &&
      methodConfig.popupEventName
    ) {
      // For sys methods, params are usually in array form already
      const popupData = params?.[0] || params;
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

    // Get the provider for non-popup methods
    const provider = SysProvider(host);

    // Use the provider methods directly
    const providerMethod = provider[methodName];
    if (!providerMethod || typeof providerMethod !== 'function') {
      throw cleanErrorStack(ethErrors.rpc.methodNotFound());
    }

    // Execute the method - always pass array for consistency
    return await providerMethod(params || []);
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
