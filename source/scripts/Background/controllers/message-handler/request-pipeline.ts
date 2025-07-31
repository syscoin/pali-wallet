import { PsbtUtils } from '@sidhujag/sysweb3-keyring';
import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import store from 'state/store';
import { INetworkType } from 'types/network';
import cleanErrorStack from 'utils/cleanErrorStack';

import { clearProviderCache } from './method-handlers';
import {
  isMethodAllowedForHardwareWallet,
  methodRequiresConnection,
} from './method-registry';
import { popupPromise } from './popup-promise';
import {
  IEnhancedRequestContext,
  NetworkPreference,
  NetworkEnforcement,
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
      // For connection popups, return the existing popup's result instead of rejecting
      if (
        this.activePopupRoute === currentRoute &&
        currentRoute === MethodRoute.Connect
      ) {
        console.log(
          '[RequestCoordinator] Duplicate connection request detected, returning existing popup result'
        );
        try {
          // Wait for the existing popup to complete and return its result
          return await this.activePopupRequest;
        } catch (error) {
          // If the existing popup was rejected, throw the same error
          throw error;
        }
      }

      // If it's the same route (but not connection), reject with specific error
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
      // give it some time to ensure any previous popup is closed
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      // Add delay to ensure previous popup is fully closed
      setTimeout(() => {
        this.requestExecutor(originalRequest.host, {
          method: originalRequest.method,
          params: originalRequest.params,
          network: originalRequest.network,
        })
          .then(nextRequest.resolve)
          .catch(nextRequest.reject);
      }, 100);
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
  const activeAccountData = accounts[activeAccount.type]?.[activeAccount.id];

  // Check if active account exists
  if (!activeAccountData) {
    console.error('[hardwareWalletMiddleware] Active account not found');
    throw new Error('Active account not found');
  }

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
  const { dapp } = getController();

  // Check network preferences and enforcement from method config
  const networkPreference = methodConfig.networkPreference;
  const networkEnforcement = methodConfig.networkEnforcement;

  // If method doesn't care about network type or never enforces, continue
  if (
    networkPreference === NetworkPreference.Any ||
    networkEnforcement === NetworkEnforcement.Never
  ) {
    return next();
  }

  // Check if we should enforce based on the enforcement type
  let shouldEnforce = false;

  if (networkEnforcement === NetworkEnforcement.Always) {
    // Always enforce network preference
    shouldEnforce = true;
  } else if (networkEnforcement === NetworkEnforcement.BeforeConnection) {
    // Only enforce if this is a connection-establishing method and not yet connected
    shouldEnforce =
      methodRequiresConnection(originalRequest.method) &&
      !dapp.isConnected(originalRequest.host);
  } else {
    // NetworkEnforcement.Never or any other case - don't enforce
    shouldEnforce = false;
  }

  if (!shouldEnforce) {
    return next();
  }

  // Check if we're on the wrong network type
  const needsEVM =
    networkPreference === NetworkPreference.EVM && isBitcoinBased;
  const needsUTXO =
    networkPreference === NetworkPreference.UTXO && !isBitcoinBased;

  if (needsEVM || needsUTXO) {
    console.log(
      '[Pipeline] Network type mismatch for request: ',
      originalRequest.method,
      ' enforcing network switch...'
    );

    try {
      // Use the standard network switching UI with disabled current network type
      // This provides better UX by letting users choose their preferred network
      const targetNetworkType = needsEVM ? 'ethereum' : 'syscoin';
      const currentNetworkType = needsEVM ? 'syscoin' : 'ethereum';
      await requestCoordinator.coordinatePopupRequest(
        context,
        () =>
          popupPromise({
            host: originalRequest.host,
            route: MethodRoute.SwitchNetwork,
            eventName: 'switchNetwork',
            data: {
              disabledNetworkType: currentNetworkType, // Disable current type to force switch
              forceNetworkType: targetNetworkType, // Force selection of target type
              isTypeSwitch: true, // Indicate this is a network type switch, not just network switch
            },
          }),
        MethodRoute.SwitchNetwork // Explicit route parameter
      );

      // Network has been switched, continue with the request
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
  if (validatePrefixAndCurrentChain) {
    await requestCoordinator.coordinatePopupRequest(
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
  }

  // Check if we're switching between UTXO and EVM network types
  const isTargetNetworkBitcoinBased = newChainValue === 'syscoin';
  const isNetworkTypeSwitch = isBitcoinBased !== isTargetNetworkBitcoinBased;

  if (isNetworkTypeSwitch && dapp.isConnected(originalRequest.host)) {
    // Network type is changing (UTXO <-> EVM), the dapp's connected account
    // will be invalid for the new network type, so disconnect it
    console.log(
      `[Pipeline] Network type switch detected for ${originalRequest.host}, disconnecting dapp`
    );
    dapp.disconnect(originalRequest.host);

    // The dapp is now disconnected. Let the pipeline continue so
    // connectionMiddleware can handle reconnection if needed
  }

  // Continue to the next middleware
  // The connectionMiddleware will check if the method requires connection
  // and handle reconnection if needed (especially after a network type switch)
  return next();
};

// Middleware: Connection Check
export const connectionMiddleware: Middleware = async (context, next) => {
  const { dapp } = getController();
  const { vault } = store.getState();
  const { isBitcoinBased, activeNetwork } = vault;
  const { originalRequest } = context;

  // Use helper method to check if method requires connection
  if (methodRequiresConnection(originalRequest.method)) {
    const isConnected = dapp.isConnected(originalRequest.host);

    if (!isConnected) {
      // Not connected - open connection popup
      try {
        await requestCoordinator.coordinatePopupRequest(
          context,
          () =>
            popupPromise({
              host: originalRequest.host,
              route: MethodRoute.Connect, // Always use Connect route for connection
              eventName: 'connect', // Always use connect event for connection
              data: {
                chain: isBitcoinBased
                  ? INetworkType.Syscoin
                  : INetworkType.Ethereum,
                chainId: activeNetwork.chainId,
              },
            }),
          MethodRoute.Connect // Explicit route parameter
        );

        // Connection successful - clear cached provider state
        // This ensures methods like eth_accounts return fresh data after connection
        clearProviderCache();

        // Connection successful, continue to method handler
        // The method handler will return the appropriate result
      } catch (error) {
        throw cleanErrorStack(
          ethErrors.provider.unauthorized('Connection required')
        );
      }
    }
  }

  return next();
};

// Helper functions for account switching middleware
const extractEvmAddressFromParams = (
  method: string,
  params: any[]
): string | undefined => {
  // Handle eth_sendTransaction
  if (method === 'eth_sendTransaction' && params?.[0]?.from) {
    return params[0].from;
  }

  // Handle signing methods
  if (
    (method === 'eth_sign' ||
      method === 'personal_sign' ||
      method.startsWith('eth_signTypedData')) &&
    params?.length >= 2
  ) {
    // Check both parameters for address format
    const addr1 = params[0];
    const addr2 = params[1];

    // EVM addresses start with 0x and are 42 chars
    if (
      addr1 &&
      typeof addr1 === 'string' &&
      addr1.startsWith('0x') &&
      addr1.length === 42
    ) {
      return addr1;
    } else if (
      addr2 &&
      typeof addr2 === 'string' &&
      addr2.startsWith('0x') &&
      addr2.length === 42
    ) {
      return addr2;
    }
  }

  return undefined;
};

const extractUtxoAddressFromPsbt = async (
  psbtData: any,
  accounts: any
): Promise<string | undefined> => {
  if (!psbtData || typeof psbtData !== 'object' || !psbtData.psbt) {
    return undefined;
  }

  try {
    const psbtObj = PsbtUtils.fromPali(psbtData);

    // Look through inputs to find the first unsigned input that belongs to our wallet
    if (psbtObj?.data?.inputs) {
      for (let i = 0; i < psbtObj.data.inputs.length; i++) {
        const dataInput = psbtObj.data.inputs[i];

        // Check if this input is already signed (skip if signed)
        if (dataInput.partialSig && dataInput.partialSig.length > 0) {
          continue;
        }

        // Extract address from unknownKeyVals if available
        if (dataInput.unknownKeyVals && dataInput.unknownKeyVals.length > 0) {
          // Look for the address in unknownKeyVals
          for (const kv of dataInput.unknownKeyVals) {
            if (kv.key?.equals?.(Buffer.from('address'))) {
              const inputAddress = kv.value.toString();

              // Check if this address belongs to any of our accounts
              const accountExists = Object.values(accounts).some(
                (accountsOfType: any) =>
                  accountsOfType &&
                  Object.values(accountsOfType).some(
                    (account: any) => account.address === inputAddress
                  )
              );

              if (accountExists) {
                // Found the first unsigned input that belongs to our wallet
                return inputAddress;
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[Pipeline] Error decoding PSBT:', error);
  }

  return undefined;
};

const findAccountByAddress = (
  address: string,
  accounts: any
): { account: any; accountType: string } | null => {
  const addressLower = address.toLowerCase();

  for (const accountType of Object.keys(accounts)) {
    const accountsOfType = accounts[accountType];
    if (accountsOfType) {
      for (const [accountId, accountData] of Object.entries(accountsOfType)) {
        const account = accountData as any;
        if (account.address && account.address.toLowerCase() === addressLower) {
          return {
            account: { ...account, id: parseInt(accountId) },
            accountType,
          };
        }
      }
    }
  }

  return null;
};

const promptAccountSwitch = async (
  context: IEnhancedRequestContext,
  targetAccount: any,
  targetAccountType: string
): Promise<void> => {
  await requestCoordinator.coordinatePopupRequest(
    context,
    () =>
      popupPromise({
        host: context.originalRequest.host,
        route: MethodRoute.ChangeActiveConnectedAccount,
        eventName: 'changeActiveConnected',
        data: {
          connectedAccount: targetAccount,
          accountType: targetAccountType,
        },
      }),
    MethodRoute.ChangeActiveConnectedAccount
  );
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

  // Safety check: ensure active account exists
  if (
    !accounts[activeAccount.type] ||
    !accounts[activeAccount.type]?.[activeAccount.id]
  ) {
    console.error('[Pipeline] Active account not found:', activeAccount);
    throw cleanErrorStack(
      ethErrors.provider.unauthorized(
        'Active account not found. Please select a valid account.'
      )
    );
  }

  // Check if the request has a 'from' address that we need to validate
  let requiredFromAddress: string | undefined;

  // Extract 'from' address based on method type
  requiredFromAddress = extractEvmAddressFromParams(
    originalRequest.method,
    originalRequest.params
  );

  // If not EVM, check for UTXO transactions
  if (
    !requiredFromAddress &&
    (originalRequest.method === 'sys_signAndSend' ||
      originalRequest.method === 'sys_sign')
  ) {
    requiredFromAddress = await extractUtxoAddressFromPsbt(
      originalRequest.params?.[0],
      accounts
    );
  }

  // If we have a required from address, validate it exists and switch to it if needed
  if (requiredFromAddress) {
    const accountInfo = findAccountByAddress(requiredFromAddress, accounts);

    // If the required address doesn't exist in the wallet, throw clear error
    if (!accountInfo) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          `The address ${requiredFromAddress} is not available in this wallet. It may have been removed or the wallet may have been reinstalled. Please reconnect with a valid account.`
        )
      );
    }

    // Check if we're already on the correct account
    const activeAccountData = accounts[activeAccount.type]?.[activeAccount.id];
    if (
      activeAccountData?.address.toLowerCase() ===
      requiredFromAddress.toLowerCase()
    ) {
      // Already on the correct account
      return next();
    }

    console.log(
      '[Pipeline] Transaction requires switching to address:',
      requiredFromAddress
    );

    // Need to switch to the required account
    try {
      await promptAccountSwitch(
        context,
        accountInfo.account,
        accountInfo.accountType
      );

      // Account switched successfully, continue with the request
      return next();
    } catch (error) {
      throw cleanErrorStack(
        ethErrors.provider.unauthorized(
          'Must switch to the required account for this operation'
        )
      );
    }
  }

  // Original logic for DApp connected account validation
  const account = dapp.getAccount(originalRequest.host);
  if (!account) {
    // Not connected, connection middleware should have handled this
    return next();
  }

  // Capture state atomically to prevent race conditions
  const currentVaultState = store.getState().vault;
  const activeAccountData =
    currentVaultState.accounts[currentVaultState.activeAccount.type]?.[
      currentVaultState.activeAccount.id
    ];

  if (activeAccountData?.address === account.address) {
    // Already on the correct account
    return next();
  }

  console.log(
    '[Pipeline] Blocking method requires switching to connected account...'
  );

  // Need to switch to the connected account
  const dappAccountType = account.isImported ? 'Imported' : 'HDAccount';

  try {
    await promptAccountSwitch(context, account, dappAccountType);
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

  if (!requiresAuth || hasPopup || isUnlocked) {
    return next();
  }

  try {
    // Open login popup
    await requestCoordinator.coordinatePopupRequest(
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

    // Wallet should now be unlocked, continue with the request
    return next();
  } catch (error) {
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Authentication cancelled')
    );
  }
};

// Middleware: Popup Optimization - Skip unnecessary popups
export const popupOptimizationMiddleware: Middleware = async (
  context,
  next
) => {
  const { methodConfig, originalRequest } = context;
  const { method, host, params } = originalRequest;

  // Only process methods that have popups
  if (!methodConfig.hasPopup) {
    return next();
  }

  const { dapp } = getController();
  const { vault } = store.getState();
  const methodName = method.split('_')[1] || method;

  // Check if we can skip the popup for this method
  switch (methodName) {
    case 'ENABLE':
    case 'requestAccounts':
      // Skip connect popup if already connected
      if (dapp.isConnected(host)) {
        const account = dapp.getAccount(host);
        if (account) {
          // Return the expected result without showing popup
          if (
            methodName === 'requestAccounts' ||
            method === 'eth_requestAccounts'
          ) {
            return [account.address];
          }
          // For ENABLE, return the connected account
          return account;
        }
      }
      break;

    case 'requestPermissions':
      // Check if permissions already exist
      const requestedPermissions = params?.[0] || {};
      const hasEthAccounts = 'eth_accounts' in requestedPermissions;

      if (hasEthAccounts && dapp.isConnected(host)) {
        // Already have account permissions, return current permissions
        const account = dapp.getAccount(host);
        const dappInfo = dapp.get(host);

        if (account && dappInfo) {
          const permissions = [
            {
              id: '1',
              parentCapability: 'eth_accounts',
              invoker: host,
              caveats: [
                {
                  type: 'restrictReturnedAccounts',
                  value: [account.address],
                },
              ],
              date: dappInfo.date,
            },
          ];

          // Add chain permissions for EVM
          if (vault && !vault.isBitcoinBased) {
            permissions.push({
              id: '2',
              parentCapability: 'endowment:permitted-chains',
              invoker: host,
              caveats: [
                {
                  type: 'restrictNetworkSwitching',
                  value: [`0x${vault.activeNetwork.chainId.toString(16)}`],
                },
              ],
              date: dappInfo.date,
            });
          }

          return permissions;
        }
      }
      break;

    case 'switchEthereumChain':
      // Already handled by middleware, but double-check
      const targetChainId = Number(params?.[0]?.chainId);
      if (vault.activeNetwork.chainId === targetChainId) {
        return null; // Already on correct chain
      }
      break;

    case 'addEthereumChain':
      // Check if chain already exists
      const chainConfig = params?.[0];
      if (chainConfig?.chainId) {
        const chainId = Number(chainConfig.chainId);
        const { vaultGlobal } = store.getState();

        // Check if we're trying to add the current network
        if (vault.activeNetwork.chainId === chainId) {
          // Network already active, no need to add
          return null;
        }

        // Check if chain exists in available networks
        const ethereumNetworks = vaultGlobal.networks?.ethereum || {};
        const chainExists = ethereumNetworks[chainId] !== undefined;

        if (chainExists) {
          // Chain already exists, no need to add
          return null;
        }
      }
      break;

    case 'watchAsset':
      // Check if asset already exists
      const assetParams = params?.[0];
      if (assetParams?.options?.address) {
        const activeAccount = vault.activeAccount;
        const { accountAssets } = vault;

        if (activeAccount && accountAssets) {
          const accountAsset =
            accountAssets[activeAccount.type]?.[activeAccount.id];

          if (accountAsset && accountAsset.ethereum) {
            const assetExists = accountAsset.ethereum.some(
              (asset: any) =>
                asset.contractAddress?.toLowerCase() ===
                assetParams.options.address.toLowerCase()
            );

            if (assetExists) {
              // Asset already added
              return true;
            }
          }
        }
      }
      break;

    case 'changeAccount':
      // Check if we're already using the requested account
      if (params && dapp.isConnected(host)) {
        const requestedAccountId = params[0]?.currentAccountId;
        const requestedAccountType = params[0]?.currentAccountType;
        const dappInfo = dapp.get(host);

        if (
          dappInfo &&
          requestedAccountId !== undefined &&
          requestedAccountType !== undefined &&
          dappInfo.accountId === requestedAccountId &&
          dappInfo.accountType === requestedAccountType
        ) {
          // Already using this account, no need to change
          // Return the expected format for changeAccount
          const account = dapp.getAccount(host);
          return account;
        }
      }
      break;

    // For sign/send methods, we always need user approval
    // So we don't skip these popups
  }

  // Continue to next middleware (popup will be shown)
  return next();
};

// Create the default pipeline
export function createDefaultPipeline(): RequestPipeline {
  return new RequestPipeline()
    .use(networkStatusMiddleware) // Check network status first
    .use(hardwareWalletMiddleware)
    .use(networkCompatibilityMiddleware)
    .use(utxoEvmSwitchMiddleware) // Handle network switching
    .use(popupOptimizationMiddleware) // Skip unnecessary popups BEFORE auth/connection checks
    .use(authenticationMiddleware) // Auth check before connection
    .use(connectionMiddleware) // Connection after auth
    .use(accountSwitchingMiddleware);
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
