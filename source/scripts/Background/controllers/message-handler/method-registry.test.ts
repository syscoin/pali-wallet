/**
 * Example usage of the method registry system
 * This demonstrates how to use the registry for various operations
 */

import {
  getMethodConfig,
  methodRequiresAuth,
  isMethodAllowedForHardwareWallet,
  getBlockingMethods,
  getMethodsByNetworkRequirement,
  getMethodPopupConfig,
  isValidMethod,
} from './method-registry';
import { NetworkRequirement } from './types';

// Example 1: Check if a method requires authentication
console.log(
  'eth_sendTransaction requires auth:',
  methodRequiresAuth('eth_sendTransaction')
); // true
console.log('eth_chainId requires auth:', methodRequiresAuth('eth_chainId')); // false

// Example 2: Check if a method is allowed for hardware wallets
console.log(
  'sys_signMessage allowed for HW:',
  isMethodAllowedForHardwareWallet('sys_signMessage')
); // false
console.log(
  'eth_accounts allowed for HW:',
  isMethodAllowedForHardwareWallet('eth_accounts')
); // true

// Example 3: Get all blocking methods
const blockingMethods = getBlockingMethods();
console.log('Blocking methods:', blockingMethods);
// ['eth_sendTransaction', 'eth_sign', 'personal_sign', ...]

// Example 4: Get methods by network requirement
const evmOnlyMethods = getMethodsByNetworkRequirement(NetworkRequirement.EVM);
console.log('EVM-only methods:', evmOnlyMethods.slice(0, 5)); // First 5 methods

// Example 5: Check popup configuration
const sendTxPopupConfig = getMethodPopupConfig('eth_sendTransaction');
console.log('eth_sendTransaction popup config:', sendTxPopupConfig);
// { route: 'send-eth', eventName: 'eth_sendTransaction' }

// Example 6: Validate method exists
console.log(
  'eth_sendTransaction is valid:',
  isValidMethod('eth_sendTransaction')
); // true
console.log('fake_method is valid:', isValidMethod('fake_method')); // false

// Example 7: Get full method configuration
const methodConfig = getMethodConfig('wallet_getBalance');
console.log('wallet_getBalance config:', methodConfig);
/*
{
  name: 'wallet_getBalance',
  handlerType: 'wallet',
  requiresTabId: true,
  requiresAuth: true,
  requiresConnection: true,
  allowHardwareWallet: true,
  networkRequirement: 'any',
  hasPopup: false,
  requiresActiveAccount: true
}
*/
