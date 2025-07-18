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

// Type for the request executor function
export type RequestExecutor = (
  host: string,
  data: {
    method: string;
    network?: string;
    params?: any;
  }
) => Promise<any>;

// Global request coordination to prevent multiple popups
class RequestCoordinator {
  private static instance: RequestCoordinator;
  private activePopupRequest: Promise<any> | null = null;
  private activePopupRoute: MethodRoute | null = null;
  private requestExecutor: RequestExecutor | null = null;
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

  // Set the request executor function to avoid circular dependencies
  setRequestExecutor(executor: RequestExecutor): void {
    this.requestExecutor = executor;
  }

  async coordinatePopupRequest(
    context: IEnhancedRequestContext,
    popupFunction: () => Promise<any>,
    explicitRoute?: MethodRoute
  ): Promise<any> {
    // Use explicit route if provided, otherwise fall back to context route
    const currentRoute = explicitRoute || context.methodConfig.popupRoute;

    // If there's already an active popup request, check for deduplication
    if (this.activePopupRequest) {
      // If it's the same route, reject with specific error
      if (this.activePopupRoute === currentRoute) {
        throw cleanErrorStack(
          ethErrors.provider.userRejectedRequest(
            `Duplicate ${currentRoute} request - another ${currentRoute} popup is already active`
          )
        );
      }
      // Different route, queue this one
      return new Promise((resolve, reject) => {
        this.requestQueue.push({
          context,
          resolve,
          reject,
        });

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
    this.activePopupRoute = currentRoute;

    try {
      const result = await this.activePopupRequest;
      return result;
    } catch (error) {
      throw error;
    } finally {
      this.activePopupRequest = null;
      this.activePopupRoute = null;
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

    // Check if network is idle before processing queued requests
    const { networkStatus } = store.getState().vaultGlobal;
    if (networkStatus !== 'idle') {
      // Network is not ready, check again later
      setTimeout(() => this.processQueue(), 100);
      return;
    }

    // Process the next request in the queue
    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      if (!this.requestExecutor) {
        nextRequest.reject(
          cleanErrorStack(
            ethErrors.rpc.internal('Request pipeline not properly initialized')
          )
        );
        return;
      }

      // Re-execute the original request with current state
      // This ensures all middleware checks run with current auth/network state
      const { originalRequest } = nextRequest.context;
      this.requestExecutor(originalRequest.host, {
        method: originalRequest.method,
        params: originalRequest.params,
        network: originalRequest.network,
      })
        .then(nextRequest.resolve)
        .catch(nextRequest.reject);
    }
  }

  // Method to check if coordinator is busy (for debugging)
  isActive(): boolean {
    return this.activePopupRequest !== null;
  }

  // Method to clear all queued requests (used when network operations are cancelled)
  clearQueue(): void {
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        request.reject(
          cleanErrorStack(
            ethErrors.provider.userRejectedRequest(
              'Request cancelled due to network operation cancellation'
            )
          )
        );
      }
    }
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

// Request pipeline for processing messages
export class RequestPipeline {
  private middlewares: Middleware[] = [];
  private isProcessing = false;
  private requestQueue: Array<{
    context: IEnhancedRequestContext;
    reject: (error: any) => void;
    resolve: (value: any) => void;
  }> = [];

  use(middleware: Middleware): RequestPipeline {
    this.middlewares.push(middleware);
    return this;
  }

  async execute(context: IEnhancedRequestContext): Promise<any> {
    const { methodConfig } = context;

    // Check if this is a non-blocking, read-only request that can bypass the queue
    const canBypassQueue =
      !methodConfig.hasPopup &&
      !methodConfig.isBlocking &&
      !methodConfig.requiresAuth &&
      !methodConfig.requiresConnection;

    // If it's a read-only request and we're processing something else, let it through
    if (canBypassQueue && this.isProcessing) {
      return this.runMiddlewares(context);
    }

    // If already processing a request, queue this one
    if (this.isProcessing) {
      console.log(
        `[Pipeline] Request ${context.originalRequest.method} queued, another request is in progress`
      );
      return new Promise((resolve, reject) => {
        const queueEntry = { context, resolve, reject };
        this.requestQueue.push(queueEntry);

        // Determine appropriate timeout based on method type
        const timeoutMs = 60000; // 60 seconds default

        console.log(
          `[Pipeline] Queue timeout for ${context.originalRequest.method}: ${
            timeoutMs / 1000
          }s`
        );

        // Set a timeout for QUEUED requests only (not the executing one)
        setTimeout(() => {
          const index = this.requestQueue.indexOf(queueEntry);
          if (index !== -1) {
            // This request is STILL in the queue after timeout (not being processed)
            this.requestQueue.splice(index, 1);
            console.warn(
              `[Pipeline] Request ${
                context.originalRequest.method
              } timed out waiting in queue after ${timeoutMs / 1000}s`
            );
            reject(
              cleanErrorStack(
                ethErrors.provider.userRejectedRequest(
                  `Request timed out waiting in queue. Please try again.`
                )
              )
            );
          }
          // If index === -1, the request has been dequeued and is being processed, so we do nothing
        }, timeoutMs);
      });
    }

    // Mark as processing
    this.isProcessing = true;

    try {
      const result = await this.runMiddlewares(context);
      return result;
    } finally {
      // Mark as not processing and handle next request
      this.isProcessing = false;
      this.processNextRequest();
    }
  }

  private async runMiddlewares(context: IEnhancedRequestContext): Promise<any> {
    let index = 0;

    const next = async (): Promise<any> => {
      if (index >= this.middlewares.length) {
        // All middleware passed, but no result returned
        // This should not happen as the final middleware should handle the request
        throw new Error('No handler found for request');
      }

      const middleware = this.middlewares[index++];
      return middleware(context, next);
    };

    return next();
  }

  private processNextRequest(): void {
    if (this.requestQueue.length === 0) return;

    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      // Process the next request
      this.execute(nextRequest.context)
        .then(nextRequest.resolve)
        .catch(nextRequest.reject);
    }
  }

  // Debug methods
  getQueueLength(): number {
    return this.requestQueue.length;
  }

  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  getQueuedMethods(): string[] {
    return this.requestQueue.map((item) => item.context.originalRequest.method);
  }
}

// Middleware: Network Status Check
export const networkStatusMiddleware: Middleware = async (context, next) => {
  const { networkStatus } = store.getState().vaultGlobal;
  if (networkStatus !== 'idle') {
    // Wait for network to be idle - no timeout
    // User can cancel by closing tab/popup or navigating away
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const currentStatus = store.getState().vaultGlobal.networkStatus;

        if (currentStatus === 'idle') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100); // Check every 100ms
    });
  }

  return next();
};

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
  const { vault } = store.getState();
  const { isBitcoinBased } = vault;
  const { methodConfig, originalRequest } = context;

  // Check network requirements from method config
  const requiredNetwork = methodConfig.networkRequirement;

  // If method doesn't care about network type, continue
  if (requiredNetwork === NetworkRequirement.Any) {
    return next();
  }

  // Check if we're on the wrong network type
  const needsEVM = requiredNetwork === NetworkRequirement.EVM && isBitcoinBased;
  const needsUTXO =
    requiredNetwork === NetworkRequirement.UTXO && !isBitcoinBased;

  if (needsEVM || needsUTXO) {
    console.log(
      '[Pipeline] Network type mismatch for request: ',
      originalRequest.method,
      ' using changeUTXOEVM to switch...'
    );

    try {
      // Use the standard network switching UI with disabled current network type
      // This provides better UX by letting users choose their preferred network
      const targetNetworkType = needsEVM ? 'ethereum' : 'syscoin';
      const currentNetworkType = needsEVM ? 'syscoin' : 'ethereum';
      const result = await requestCoordinator.coordinatePopupRequest(
        context,
        () =>
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
          }),
        MethodRoute.SwitchNetwork // Explicit route parameter
      );

      if (!result) {
        throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
      }

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

// Middleware: Network Type Switch for changeUTXOEVM
export const utxoEvmSwitchMiddleware: Middleware = async (context, next) => {
  const { originalRequest } = context;

  // Only handle changeUTXOEVM methods
  if (!originalRequest.method.includes('changeUTXOEVM')) {
    return next();
  }

  const { vault, vaultGlobal } = store.getState();
  const { isBitcoinBased } = vault;
  const { networks } = vaultGlobal;
  const { dapp } = getController();

  const params = originalRequest.params;
  const chainId = params?.[0]?.chainId;

  if (!chainId) {
    throw cleanErrorStack(ethErrors.rpc.invalidParams('chainId is required'));
  }

  // Validate prefix matches current network type
  const validatePrefixAndCurrentChain =
    (originalRequest.method?.toLowerCase() === 'eth_changeutxoevm' &&
      isBitcoinBased) ||
    (originalRequest.method?.toLowerCase() === 'sys_changeutxoevm' &&
      !isBitcoinBased);

  if (!validatePrefixAndCurrentChain) {
    throw cleanErrorStack(
      ethErrors.provider.unauthorized(
        'changeUTXOEVM requires correct network type and prefix'
      )
    );
  }

  const newChainValue =
    originalRequest.method?.toLowerCase() === 'sys_changeutxoevm'
      ? 'syscoin'
      : 'ethereum';
  const targetNetwork = networks[newChainValue.toLowerCase()][chainId];

  if (!targetNetwork) {
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Network does not exist')
    );
  }

  const result = await requestCoordinator.coordinatePopupRequest(
    context,
    () =>
      popupPromise({
        host: originalRequest.host,
        route: MethodRoute.SwitchUtxoEvm,
        eventName: 'change_UTXOEVM',
        data: {
          newNetwork: targetNetwork,
          newChainValue: newChainValue,
        },
      }),
    MethodRoute.SwitchUtxoEvm
  );

  if (!result) {
    throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
  }
  // Small delay to ensure network switch completes
  await new Promise((resolve) => setTimeout(resolve, 100));
  const isConnected = dapp.isConnected(originalRequest.host);

  if (isConnected) {
    const result1 = await requestCoordinator.coordinatePopupRequest(
      context,
      () =>
        popupPromise({
          host: originalRequest.host,
          route: MethodRoute.ChangeAccount,
          eventName: 'accountsChanged',
          data: { network: targetNetwork },
        }),
      MethodRoute.ChangeAccount
    );
    if (!result1) {
      throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
    }
  }
  // Note: We don't call next() here because we've handled the entire request
};

// Middleware: Connection Check
export const connectionMiddleware: Middleware = async (context, next) => {
  const { dapp } = getController();
  const { vault } = store.getState();
  const { isBitcoinBased, activeNetwork } = vault;
  const { originalRequest } = context;

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
            route: MethodRoute.Connect, // Always use Connect route for connection
            eventName: 'connect', // Always use connect event for connection
            data: {
              chain: isBitcoinBased ? 'syscoin' : 'ethereum',
              chainId: activeNetwork.chainId,
              method: originalRequest.method,
            },
          }),
        MethodRoute.Connect // Explicit route parameter
      );

      if (!result) {
        throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
      }

      // Connection successful, continue to method handler
      // The method handler will return the appropriate result
    } catch (error) {
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
        }),
      MethodRoute.ChangeActiveConnectedAccount // Explicit route parameter
    );

    if (!response) {
      throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
    }
  } catch (error) {
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
  const controller = getController();
  const isUnlocked = controller.wallet.isUnlocked();

  // Check if ANY keyring is unlocked (for network switching scenarios)
  const isAnyKeyringUnlocked = controller.wallet.isAnyKeyringUnlocked();

  if (!requiresAuth || hasPopup || isUnlocked || isAnyKeyringUnlocked) {
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
        }),
      MethodRoute.Login // Explicit route parameter
    );

    if (!result) {
      throw cleanErrorStack(ethErrors.provider.userRejectedRequest());
    }

    // Wallet should now be unlocked, continue with the request
    return next();
  } catch (error) {
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Authentication cancelled')
    );
  }
};

// Create the default pipeline
export function createDefaultPipeline(): RequestPipeline {
  return new RequestPipeline()
    .use(networkStatusMiddleware) // Check network status first
    .use(hardwareWalletMiddleware)
    .use(networkCompatibilityMiddleware)
    .use(utxoEvmSwitchMiddleware) // Add the new middleware here
    .use(connectionMiddleware)
    .use(accountSwitchingMiddleware)
    .use(authenticationMiddleware); // Auth check last - other middleware handle auth in their popups
  // Method handler middleware is added in requests.ts
}

// Export a singleton instance for debugging
let pipelineInstance: RequestPipeline | null = null;

export function getPipelineInstance(): RequestPipeline | null {
  return pipelineInstance;
}

export function setPipelineInstance(pipeline: RequestPipeline): void {
  pipelineInstance = pipeline;
}
