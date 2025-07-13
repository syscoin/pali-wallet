import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import store from 'state/store';
import cleanErrorStack from 'utils/cleanErrorStack';

import {
  isMethodAllowedForHardwareWallet,
  methodRequiresConnection,
} from './method-registry';
import { popupPromise } from './popup-promise';
import {
  IEnhancedRequestContext,
  NetworkRequirement,
  MethodRoute,
} from './types';

// Global request coordination to prevent multiple popups
class RequestCoordinator {
  private static instance: RequestCoordinator;
  private activePopupRequest: Promise<any> | null = null;
  private requestQueue: Array<{
    context: IEnhancedRequestContext;
    reject: (error: any) => void;
    resolve: (value: any) => void;
  }> = [];

  static getInstance(): RequestCoordinator {
    if (!RequestCoordinator.instance) {
      RequestCoordinator.instance = new RequestCoordinator();
    }
    return RequestCoordinator.instance;
  }

  async coordinatePopupRequest(
    context: IEnhancedRequestContext,
    popupFunction: () => Promise<any>
  ): Promise<any> {
    // If there's already an active popup request, queue this one
    if (this.activePopupRequest) {
      return new Promise((resolve, reject) => {
        this.requestQueue.push({ context, resolve, reject });

        // Set a timeout to prevent infinite waiting
        setTimeout(() => {
          const index = this.requestQueue.findIndex(
            (req) => req.context === context
          );
          if (index !== -1) {
            this.requestQueue.splice(index, 1);
            reject(
              cleanErrorStack(
                ethErrors.provider.userRejectedRequest(
                  'Request timed out - another popup is active'
                )
              )
            );
          }
        }, 30000); // 30 second timeout
      });
    }

    // Execute the popup request
    this.activePopupRequest = this.executePopupRequest(popupFunction);

    try {
      const result = await this.activePopupRequest;
      return result;
    } finally {
      this.activePopupRequest = null;
      this.processQueue();
    }
  }

  private async executePopupRequest(
    popupFunction: () => Promise<any>
  ): Promise<any> {
    try {
      return await popupFunction();
    } catch (error) {
      throw error;
    }
  }

  private processQueue(): void {
    if (this.requestQueue.length === 0) return;

    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      // For now, reject queued requests to prevent complexity
      // In practice, users should wait for the first popup to complete
      nextRequest.reject(
        cleanErrorStack(
          ethErrors.provider.userRejectedRequest(
            'Another popup is currently active. Please wait and try again.'
          )
        )
      );
    }
  }

  // Method to check if coordinator is busy (for debugging)
  isActive(): boolean {
    return this.activePopupRequest !== null;
  }
}

const requestCoordinator = RequestCoordinator.getInstance();

// Export for use in method handlers
export { requestCoordinator };

export type NextFunction = () => Promise<any>;
export type Middleware = (
  context: IEnhancedRequestContext,
  next: NextFunction
) => Promise<any>;

export class RequestPipeline {
  private middlewares: Middleware[] = [];

  use(middleware: Middleware): RequestPipeline {
    this.middlewares.push(middleware);
    return this;
  }

  async execute(context: IEnhancedRequestContext): Promise<any> {
    let index = 0;

    const next = async (): Promise<any> => {
      if (index >= this.middlewares.length) {
        throw new Error('No handler found for request');
      }

      const middleware = this.middlewares[index++];
      return await middleware(context, next);
    };

    return await next();
  }
}

// Middleware: Hardware Wallet Check
export const hardwareWalletMiddleware: Middleware = async (context, next) => {
  const { vault } = store.getState();
  const { activeAccount, accounts } = vault;
  const activeAccountData = accounts[activeAccount.type][activeAccount.id];

  // Check if using hardware wallet
  const isHardwareWallet =
    activeAccountData.isTrezorWallet || activeAccountData.isLedgerWallet;

  // Use helper method to check if method is allowed for hardware wallet
  const method = context.originalRequest.method;
  if (!isMethodAllowedForHardwareWallet(method) && isHardwareWallet) {
    console.error('[Pipeline] Hardware wallet restriction:', method);
    throw ethErrors.provider.custom({
      code: 4874,
      message:
        'Hardware wallets cannot interact with this request. Please switch to a different account.',
    });
  }

  return next();
};

// Middleware: Network Compatibility Check
export const networkCompatibilityMiddleware: Middleware = async (
  context,
  next
) => {
  const { vault, vaultGlobal } = store.getState();
  const { isBitcoinBased } = vault;
  const { networkStatus } = vaultGlobal;
  const { methodConfig, originalRequest } = context;

  // Skip if already switching
  if (networkStatus === 'switching') {
    throw cleanErrorStack(
      ethErrors.rpc.resourceUnavailable({
        message: 'Already processing network change. Please wait',
      })
    );
  }

  // Check network requirements from method config
  const requiredNetwork = methodConfig.networkRequirement;

  // If method doesn't care about network type, continue
  if (
    requiredNetwork === NetworkRequirement.None ||
    requiredNetwork === NetworkRequirement.Any
  ) {
    return next();
  }

  // Check if we're on the wrong network type
  const needsEVM = requiredNetwork === NetworkRequirement.EVM && isBitcoinBased;
  const needsUTXO =
    requiredNetwork === NetworkRequirement.UTXO && !isBitcoinBased;

  if (needsEVM || needsUTXO) {
    console.log(
      '[Pipeline] Network type mismatch, using changeUTXOEVM to switch...'
    );

    try {
      // Use the standard network switching UI with disabled current network type
      // This provides better UX by letting users choose their preferred network
      const targetNetworkType = needsEVM ? 'ethereum' : 'syscoin';
      const currentNetworkType = needsEVM ? 'syscoin' : 'ethereum';

      await requestCoordinator.coordinatePopupRequest(context, () =>
        popupPromise({
          host: originalRequest.host,
          route: MethodRoute.SwitchNetwork,
          eventName: 'switchNetwork',
          data: {
            requiredMethod: originalRequest.method,
            targetNetworkType: requiredNetwork,
            disabledNetworkType: currentNetworkType, // Disable current type to force switch
            forceNetworkType: targetNetworkType, // Force selection of target type
            isTypeSwitch: true, // Indicate this is a network type switch, not just network switch
          },
        })
      );

      // Network type has been switched, continue with the request
    } catch (error) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          `${originalRequest.method} requires ${
            needsEVM ? 'an EVM-compatible' : 'a Bitcoin/UTXO'
          } network. Network switch was cancelled.`
        )
      );
    }
  }

  return next();
};

// Middleware: Connection Check
export const connectionMiddleware: Middleware = async (context, next) => {
  const { dapp } = getController();
  const { vault } = store.getState();
  const { isBitcoinBased, activeNetwork } = vault;
  const { methodConfig, originalRequest } = context;

  // Use helper method to check if method requires connection
  if (
    methodRequiresConnection(originalRequest.method) &&
    !dapp.isConnected(originalRequest.host)
  ) {
    // Open connection popup directly - the router will handle auth if needed
    try {
      const result = await requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host: originalRequest.host,
            route: methodConfig.popupRoute || MethodRoute.Connect,
            eventName: methodConfig.popupEventName || 'connect',
            data: {
              chain: isBitcoinBased ? 'syscoin' : 'ethereum',
              chainId: activeNetwork.chainId,
              method: originalRequest.method,
            },
          })
      );

      if (!result) {
        throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
      }

      // Check if we got a pipeline result (for requestAccounts)
      if (typeof result === 'object' && (result as any).pipelineResult) {
        return (result as any).pipelineResult;
      }

      // For requestAccounts methods, return the connected address
      if (originalRequest.method.includes('requestAccounts')) {
        // The connect-wallet popup returns the address directly
        const address =
          typeof result === 'string'
            ? result
            : (result as any)?.address || result;
        return methodConfig.returnsArray ? [address] : address;
      }
    } catch (error) {
      console.error('[Pipeline] Connection error:', error);
      throw cleanErrorStack(
        ethErrors.provider.unauthorized('Connection required')
      );
    }
  }

  return next();
};

// Middleware: Account Switching for Blocking Methods
export const accountSwitchingMiddleware: Middleware = async (context, next) => {
  const { methodConfig, originalRequest } = context;

  // Only check for blocking methods that require connection
  if (!methodConfig.isBlocking || !methodConfig.requiresConnection) {
    return next();
  }

  const { dapp } = getController();
  const { vault } = store.getState();
  const { activeAccount, accounts } = vault;

  const account = dapp.getAccount(originalRequest.host);
  if (!account) {
    // Not connected, connection middleware should have handled this
    return next();
  }

  // Check if connected account matches active account
  const activeAccountData = accounts[activeAccount.type][activeAccount.id];
  if (activeAccountData.address === account.address) {
    // Already on the correct account
    return next();
  }

  console.log(
    '[Pipeline] Blocking method requires switching to connected account...'
  );

  // Need to switch to the connected account
  const dappAccountType = account.isImported ? 'Imported' : 'HDAccount';

  try {
    const response = await requestCoordinator.coordinatePopupRequest(
      context,
      () =>
        popupPromise({
          host: originalRequest.host,
          route: MethodRoute.ChangeActiveConnectedAccount,
          eventName: 'changeActiveConnected',
          data: {
            connectedAccount: account,
            accountType: dappAccountType,
          },
        })
    );

    if (!response) {
      throw cleanErrorStack(ethErrors.rpc.internal());
    }
  } catch (error) {
    console.error('[Pipeline] Account switch error:', error);
    throw cleanErrorStack(
      ethErrors.provider.unauthorized(
        'Must switch to connected account for this operation'
      )
    );
  }

  return next();
};

// Middleware: Authentication Check
export const authenticationMiddleware: Middleware = async (context, next) => {
  const { methodConfig, originalRequest } = context;

  // Skip auth check if:
  // 1. Method doesn't require authentication
  // 2. Method has its own popup (router will handle auth within that popup for better UX)
  //    - This prevents opening separate login popup before connection popup
  //    - The popup route (like connect-wallet) handles authentication internally
  // 3. Wallet is already unlocked

  const requiresAuth = methodConfig.requiresAuth;
  const hasPopup = methodConfig.hasPopup;
  const isUnlocked = getController().wallet.isUnlocked();

  if (!requiresAuth || hasPopup || isUnlocked) {
    return next();
  }

  try {
    // Open login popup
    const result = await requestCoordinator.coordinatePopupRequest(
      context,
      () =>
        popupPromise({
          host: originalRequest.host,
          route: MethodRoute.Login,
          eventName: 'login',
          data: {
            host: originalRequest.host,
            eventName: 'login',
          },
        })
    );

    if (!result || !(result as any).success) {
      console.error('[Pipeline] Auth failed - no result or not successful');
      throw cleanErrorStack(
        ethErrors.provider.unauthorized('Authentication required')
      );
    }

    // Wallet should now be unlocked, continue with the request
    return next();
  } catch (error) {
    console.error('[Pipeline] Authentication error:', error);
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Authentication cancelled')
    );
  }
};

// Create the default pipeline
export function createDefaultPipeline(): RequestPipeline {
  return new RequestPipeline()
    .use(hardwareWalletMiddleware)
    .use(authenticationMiddleware)
    .use(networkCompatibilityMiddleware)
    .use(connectionMiddleware)
    .use(accountSwitchingMiddleware);
  // Method handler middleware is added in requests.ts
}
