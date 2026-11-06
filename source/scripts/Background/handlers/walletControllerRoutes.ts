const rendererEvmMethods = new Set([
  'decryptMessage',
  'ethSign',
  'getBalance',
  'getFeeDataWithDynamicMaxPriorityFeePerGas',
  'getRecommendedGasPrice',
  'getTxGasLimit',
  'signPersonalMessage',
  'signTypedData',
  'verifyUtxoAddress',
]);

const reviewRpcReads = new Set([
  'eth_call',
  'eth_estimateGas',
  'eth_getBlockByNumber',
]);

const forbiddenPath = new Set(['constructor', '__proto__', 'prototype']);

/** Wallet renderers use controller approval methods for all transaction sends. */
export function assertWalletControllerRoute(
  methods: unknown,
  params: unknown
): void {
  if (
    !Array.isArray(methods) ||
    !methods.length ||
    methods.some((name) => typeof name !== 'string' || forbiddenPath.has(name))
  )
    throw new Error('Invalid controller route');
  const [controller, member, method, operation] = methods;
  if (controller !== 'wallet') return;
  if (methods.length === 2 && member !== 'getActiveKeyring') return;
  if (member === 'ethereumTransaction') {
    if (methods.length === 3 && rendererEvmMethods.has(method)) return;
    if (
      methods.length === 4 &&
      method === 'web3Provider' &&
      operation === 'send' &&
      Array.isArray(params) &&
      params.length === 2 &&
      reviewRpcReads.has(params[0]) &&
      Array.isArray(params[1])
    )
      return;
  }
  throw new Error('Use the approved wallet operation');
}
