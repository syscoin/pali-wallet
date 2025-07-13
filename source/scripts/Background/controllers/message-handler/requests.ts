import { ethErrors } from 'helpers/errors';

import { getController } from 'scripts/Background';
import cleanErrorStack from 'utils/cleanErrorStack';

import {
  createDefaultMethodHandler,
  clearProviderCache as clearMethodHandlerCache,
} from './method-handlers';
import { getMethodConfig } from './method-registry';
import { createDefaultPipeline, Middleware } from './request-pipeline';
import { IEnhancedRequestContext } from './types';

// Export clearProviderCache for backward compatibility
export const clearProviderCache = () => {
  clearMethodHandlerCache();
};

// Create the method handler instance
const defaultMethodHandler = createDefaultMethodHandler();

// Create the pipeline instance
const pipeline = createDefaultPipeline();

// Add the method handler as the final middleware
const finalMethodHandlerMiddleware: Middleware = async (context) => {
  const result = await defaultMethodHandler.handle(context);
  return result;
};

// Add the method handler as the final middleware
pipeline.use(finalMethodHandlerMiddleware);

/**
 * Handles methods request with a clean pipeline architecture.
 *
 * The pipeline handles:
 * 1. Hardware wallet restrictions
 * 2. Network compatibility (switches networks if needed)
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
    return await pipeline.execute(context);
  } catch (error) {
    console.error('[Pipeline] Pipeline error:', error);
    // Ensure errors are properly cleaned
    if (error.code && error.message) {
      throw error; // Already formatted error
    }
    throw cleanErrorStack(error);
  }
};

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
