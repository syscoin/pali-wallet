import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import cleanErrorStack from 'utils/cleanErrorStack';

import {
  clearProviderCache as clearMethodHandlerCache,
  createDefaultMethodHandler,
} from './method-handlers';
import { getMethodConfig } from './method-registry';
import {
  createDefaultPipeline,
  Middleware,
  requestCoordinator,
  RequestExecutor,
  setPipelineInstance,
} from './request-pipeline';
import { IEnhancedRequestContext } from './types';

// Export clearProviderCache for backward compatibility
export const clearProviderCache = () => {
  clearMethodHandlerCache();
};

// Create the method handler instance
const defaultMethodHandler = createDefaultMethodHandler();

// Create the pipeline instance
const pipeline = createDefaultPipeline();

// Store pipeline instance for debugging
setPipelineInstance(pipeline);

// Add the method handler as the final middleware
const finalMethodHandlerMiddleware: Middleware = async (context) => {
  const result = await defaultMethodHandler.handle(context);
  return result;
};

// Add the method handler as the final middleware
pipeline.use(finalMethodHandlerMiddleware);

/**
 * Main method handler that coordinates the entire request pipeline
 * This includes:
 * 1. Hardware wallet compatibility check
 * 2. Authentication (prompts for login if needed)
 * 3. Connection (prompts for connection if needed)
 * 4. Method execution
 *
 * @param host - The requesting host/domain
 * @param data - The request data containing method and params
 * @return The method result
 */
export const methodRequest = async (
  host: string,
  data: { method: string; network?: string; params?: any[] }
) => {
  // Get method configuration from registry
  const methodConfig = getMethodConfig(data.method);

  if (!methodConfig) {
    console.warn(`[Pipeline] Unknown method: ${data.method}`);
    throw cleanErrorStack(ethErrors.rpc.methodNotFound());
  }

  // Generic params normalization: if params exists but is not an array, wrap it in an array
  // This handles cases where dApps send params as objects directly instead of [object]
  if (
    data.params !== undefined &&
    data.params !== null &&
    !Array.isArray(data.params)
  ) {
    data.params = [data.params];
  }

  // Parse the method prefix and name
  const [prefix, methodName] = data.method.includes('_')
    ? data.method.split('_')
    : [undefined, data.method];

  // Build the enhanced request context
  const context: IEnhancedRequestContext = {
    originalRequest: {
      type: 'METHOD_REQUEST',
      method: data.method,
      params: data.params,
      host,
      sender: {} as chrome.runtime.MessageSender, // Will be populated by message handler
      network: data.network,
    },
    methodConfig,
    prefix,
    methodName,
  };

  try {
    // Execute the request through the pipeline
    const result = await pipeline.execute(context);
    return result;
  } catch (error) {
    // Ensure errors are properly cleaned
    if (error.code && error.message) {
      throw error; // Already formatted error
    }
    throw cleanErrorStack(error);
  }
};

// Initialize the request coordinator with methodRequest as the executor
// This avoids circular dependencies while allowing queued requests to be re-executed
requestCoordinator.setRequestExecutor(methodRequest as RequestExecutor);

/**
 * Enable/connect wallet - for backward compatibility
 */
export const enable = async (host: string, isSyscoinDapp = false) => {
  // Route through the main method request handler
  const method = isSyscoinDapp ? 'sys_requestAccounts' : 'eth_requestAccounts';
  return methodRequest(host, { method });
};

/**
 * Check if wallet is unlocked - for backward compatibility
 */
export const isUnlocked = () => {
  const { wallet } = getController();
  return wallet.isUnlocked();
};
