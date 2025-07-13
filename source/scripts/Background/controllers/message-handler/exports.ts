/**
 * Barrel export for message handler module
 * This provides a clean API for importing message handler functionality
 */

// Request functions
export {
  methodRequest,
  enable,
  isUnlocked,
  clearProviderCache, // Exported from requests.ts for backward compatibility
} from './requests';

// Request pipeline
export {
  RequestPipeline,
  hardwareWalletMiddleware,
  networkCompatibilityMiddleware,
  connectionMiddleware,
  accountSwitchingMiddleware,
  createDefaultPipeline,
} from './request-pipeline';

// Popup promise utility
export { popupPromise } from './popup-promise';

// Message handler
export { onMessage } from './index';

// Types - must use export type for re-exporting types
export type {
  Message,
  MethodHandlerType,
  NetworkRequirement,
  MethodRoute,
  IMethodConfig,
  MethodRegistry,
  IEnhancedRequestContext,
  HardWallets,
  PaliEvents,
  PaliSyscoinEvents,
} from './types';

// Method registry - separate type exports from value exports
export {
  getMethodConfig,
  methodRequiresConnection,
  isMethodAllowedForHardwareWallet,
  getMethodsByHandlerType,
  getBlockingMethods,
  getMethodsByNetworkRequirement,
  methodHasPopup,
  getMethodPopupConfig,
  methodRequiresTabId,
  getUnrestrictedMethods,
  getRestrictedMethods,
  isValidMethod,
  getMethodCacheConfig,
  METHOD_REGISTRY,
} from './method-registry';

// Method handlers - separate interface export
export type { IMethodHandler } from './method-handlers';

export {
  WalletMethodHandler,
  InternalMethodHandler,
  EthMethodHandler,
  SysMethodHandler,
  CompositeMethodHandler,
  createDefaultMethodHandler,
  // clearProviderCache is exported from requests.ts instead
} from './method-handlers';
