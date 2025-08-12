// Common ERC-20 method signatures
export const ERC20_METHOD_SIGNATURES = {
  '0xa9059cbb': 'transfer',
  '0x23b872dd': 'transferFrom',
  '0x095ea7b3': 'approve',
  '0xdd62ed3e': 'allowance',
  '0x70a08231': 'balanceOf',
  '0x18160ddd': 'totalSupply',
  '0x313ce567': 'decimals',
  '0x06fdde03': 'name',
  '0x95d89b41': 'symbol',
  '0x39509351': 'increaseAllowance',
  '0xa457c2d7': 'decreaseAllowance',
  '0x42966c68': 'burn',
  '0x79cc6790': 'burnFrom',
  '0x40c10f19': 'mint',
} as const;

// Common ERC-721 method signatures
export const ERC721_METHOD_SIGNATURES = {
  '0x23b872dd': 'transferFrom',
  '0xb88d4fde': 'safeTransferFrom',
  '0x42842e0e': 'safeTransferFrom',
  '0x095ea7b3': 'approve',
  '0xa22cb465': 'setApprovalForAll',
  '0x6352211e': 'ownerOf',
  '0x70a08231': 'balanceOf',
  '0xe985e9c5': 'isApprovedForAll',
  '0x081812fc': 'getApproved',
  '0xc87b56dd': 'tokenURI',
  '0x06fdde03': 'name',
  '0x95d89b41': 'symbol',
  '0x4f6ccce7': 'tokenByIndex',
  '0x2f745c59': 'tokenOfOwnerByIndex',
  '0x18160ddd': 'totalSupply',
} as const;

// Common ERC-1155 method signatures
export const ERC1155_METHOD_SIGNATURES = {
  '0xf242432a': 'safeTransferFrom',
  '0x2eb2c2d6': 'safeBatchTransferFrom',
  '0x00fdd58e': 'balanceOf',
  '0x4e1273f4': 'balanceOfBatch',
  '0xa22cb465': 'setApprovalForAll',
  '0xe985e9c5': 'isApprovedForAll',
  '0x0e89341c': 'uri',
} as const;

// Common DeFi/DEX method signatures
export const DEFI_METHOD_SIGNATURES = {
  // Uniswap/SushiSwap/PancakeSwap
  '0x7ff36ab5': 'swapExactETHForTokens',
  '0x18cbafe5': 'swapExactTokensForETH',
  '0x38ed1739': 'swapExactTokensForTokens',
  '0x8803dbee': 'swapTokensForExactTokens',
  '0x4a25d94a': 'swapTokensForExactETH',
  '0xfb3bdb41': 'swapETHForExactTokens',
  '0x02751cec': 'removeLiquidityETH',
  '0xbaa2abde': 'removeLiquidity',
  '0xf305d719': 'addLiquidityETH',
  '0xe8e33700': 'addLiquidity',

  // WETH
  '0xd0e30db0': 'deposit',
  '0x2e1a7d4d': 'withdraw',

  // Common staking
  '0xe2bbb158': 'deposit',
  '0x441a3e70': 'withdraw',
  '0xa694fc3a': 'stake',
  '0x2e17de78': 'unstake',
  '0x3d18b912': 'getReward',
  '0xe9fad8ee': 'exit',

  // Lending protocols (Aave, Compound)
  '0x617ba037': 'supply',
  '0x69328dec': 'withdraw',
  '0xa415bcad': 'borrow',
  '0x573ade81': 'repay',
  '0x0e752702': 'liquidate',

  // Multicall
  '0xac9650d8': 'multicall',
  '0x5ae401dc': 'multicall',
} as const;

// Governance method signatures
export const GOVERNANCE_METHOD_SIGNATURES = {
  '0x15373e3d': 'vote',
  '0x7b3c71d3': 'propose',
  '0x56781388': 'castVote',
  '0x5c19a95c': 'delegate',
  '0xc3cda520': 'delegateBySig',
  '0x40c10f19': 'mint',
  '0x42966c68': 'burn',
} as const;

// Bridge method signatures
export const BRIDGE_METHOD_SIGNATURES = {
  '0x5b8f8584': 'bridge',
  '0x8b9e4f93': 'bridgeAsset',
  '0xa9f9e675': 'swapAndBridge',
  '0x1a4d01d2': 'deposit',
  '0x3ccfd60b': 'withdraw',
} as const;

// Combine all method signatures
export const ALL_METHOD_SIGNATURES = {
  ...ERC20_METHOD_SIGNATURES,
  ...ERC721_METHOD_SIGNATURES,
  ...ERC1155_METHOD_SIGNATURES,
  ...DEFI_METHOD_SIGNATURES,
  ...GOVERNANCE_METHOD_SIGNATURES,
  ...BRIDGE_METHOD_SIGNATURES,
} as const;

/**
 * Get a human-readable function name from a method signature
 * @param methodId - The 4-byte method signature (e.g., '0xa9059cbb')
 * @returns The function name or null if not found
 */
export const getMethodName = (methodId: string): string | null => {
  if (!methodId || methodId.length < 10) return null;

  const selector = methodId.slice(0, 10).toLowerCase();
  return ALL_METHOD_SIGNATURES[selector] || null;
};

/**
 * Get a formatted function display name with proper casing
 * @param methodName - The raw method name
 * @param nativeSymbol - The native currency symbol (e.g., 'ETH', 'SYS')
 * @returns Formatted method name for display
 */
export const formatMethodName = (
  methodName: string,
  nativeSymbol: string = 'ETH',
  t: (key: string, options?: any) => string
): string => {
  // Handle special cases that aren't actual method names
  if (methodName === 'Contract Interaction') {
    return t('transactions.contractInteraction');
  }
  if (methodName === 'Contract Deploy') {
    return t('transactions.contractDeploy');
  }
  if (methodName === 'Send') {
    return t('send.sent');
  }

  // Normalize method name: decoded data may return full signature like
  // "safeTransferFrom(address,address,uint256,uint256,bytes)". Our i18n keys
  // use only the base name. Strip the parameter list if present.
  const baseMethod = methodName.includes('(')
    ? methodName.slice(0, methodName.indexOf('('))
    : methodName;

  // Try to get translation from i18n using the base method name
  const translationKey = `transactions.methodNames.${baseMethod}`;
  const translated = t(translationKey, {
    symbol: nativeSymbol.toUpperCase(),
  });

  // If translation key exists (not the same as the key), use it
  if (translated !== translationKey) {
    return translated;
  }

  // Fallback: capitalize first letter for methods not in our translation list
  return methodName.charAt(0).toUpperCase() + methodName.slice(1);
};

/**
 * Determine if the transaction is a contract interaction based on input data
 * @param tx - The transaction object
 * @returns True if it's a contract interaction
 */
export const isContractInteraction = (tx: {
  input?: string;
  value?: string | any;
}): boolean => !!(tx.input && tx.input !== '0x' && tx.input.length > 2);

/**
 * Get transaction type label
 * @param tx - The transaction object
 * @param isSent - Whether the transaction was sent by the current account
 * @returns A descriptive label for the transaction type
 */
export const getTransactionTypeLabel = (
  tx: { input?: string; to?: string; value?: string | any },
  isSent: boolean
): string => {
  if (!tx.to || tx.to === '0x0000000000000000000000000000000000000000') {
    return 'Contract Deploy';
  }

  if (isContractInteraction(tx)) {
    const methodId = tx.input?.slice(0, 10);
    const methodName = methodId ? getMethodName(methodId) : null;

    if (methodName) {
      return methodName;
    }

    return 'Contract Interaction';
  }

  // Regular transfer
  return isSent ? 'Sent' : 'Received';
};

/**
 * Get a translated display label for transaction types
 * This is ONLY for UI display, not for logic comparisons
 * @param typeLabel - The transaction type label from getTransactionTypeLabel
 * @param t - Translation function
 * @param nativeSymbol - The native currency symbol for method formatting (optional)
 * @returns Translated label for display
 */
export const getTransactionTypeDisplayLabel = (
  typeLabel: string,
  t: (key: string, options?: any) => string,
  nativeSymbol: string = 'ETH'
): string => {
  // Handle the fixed transaction type labels
  switch (typeLabel) {
    case 'Contract Deploy':
      return t('transactions.contractDeploy');
    case 'Contract Interaction':
      return t('transactions.contractInteraction');
    case 'Sent':
      return t('send.sent');
    case 'Received':
      return t('send.received');
    default:
      // For method names, format them with translation
      return formatMethodName(typeLabel, nativeSymbol, t);
  }
};
