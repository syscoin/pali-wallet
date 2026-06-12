import { defaultAbiCoder } from '@ethersproject/abi';

/**
 * Shared smart-account (ERC-4337) error classification helpers.
 *
 * Used by both the transaction error handler (utils/errorHandling.ts) and
 * the smart-account policy screen so AA error mapping stays consistent.
 */

// hex("AA21 didn't pay prefund")
const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';

const stringifyError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

/**
 * Flatten an arbitrarily nested error (provider errors wrap JSON bodies,
 * which wrap revert data...) into one searchable string.
 */
export const getErrorText = (error: unknown, depth = 0): string => {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    try {
      return [error, getErrorText(JSON.parse(error), depth + 1)]
        .filter(Boolean)
        .join(' ');
    } catch {
      return error;
    }
  }
  if (typeof error !== 'object') {
    return String(error);
  }

  const errorRecord = error as Record<string, unknown>;
  const directParts = [
    errorRecord.message,
    errorRecord.reason,
    errorRecord.code,
    errorRecord.data,
    errorRecord.error,
    errorRecord.body,
    errorRecord.response,
    errorRecord.info,
    errorRecord.transaction,
    errorRecord.tx,
  ];
  const ownPropertyParts = Object.getOwnPropertyNames(error)
    .filter((key) => key !== 'stack')
    .map((key) => errorRecord[key]);
  const parts = [
    ...directParts,
    ...ownPropertyParts,
    stringifyError(error),
  ].flatMap((value) => {
    if (!value) {
      return [];
    }
    if (typeof value === 'string') {
      try {
        return [value, getErrorText(JSON.parse(value), depth + 1)];
      } catch {
        return [value];
      }
    }
    return [getErrorText(value, depth + 1)];
  });

  return parts.filter(Boolean).join(' ');
};

/**
 * Decode the EntryPoint FailedOp(uint256,string) custom error reason
 * (selector 0x220266b6) if present anywhere in the error payload.
 */
export const getEntryPointFailedOpReason = (error: unknown): string => {
  const message = getErrorText(error);
  const match = message.match(/0x220266b6[0-9a-fA-F]*/);
  if (!match) {
    return '';
  }

  try {
    const [, reason] = defaultAbiCoder.decode(
      ['uint256', 'string'],
      `0x${match[0].slice(10)}`
    );
    return String(reason);
  } catch {
    return '';
  }
};

/** AA21: the account (or its paymaster) couldn't pay the userOp prefund. */
export const isSmartAccountPrefundError = (error: unknown): boolean => {
  const message = getErrorText(error);
  const normalized = message.toLowerCase();
  const failedOpReason = getEntryPointFailedOpReason(error).toLowerCase();

  return (
    normalized.includes('aa21') ||
    normalized.includes("didn't pay prefund") ||
    normalized.includes('did not pay prefund') ||
    normalized.includes('prefund') ||
    normalized.includes(AA21_PREFUND_REASON_HEX) ||
    failedOpReason.includes('aa21') ||
    failedOpReason.includes('prefund')
  );
};

/** Generic "not enough native token for gas" detection. */
export const isNativeGasError = (error: unknown): boolean => {
  const message = getErrorText(error);
  const normalized = message.toLowerCase();

  return (
    message.includes('OutOfNativeResourcesDuringValidation') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient balance') ||
    message.includes('PALI_NATIVE_GAS_REQUIRED') ||
    normalized.includes('not enough native') ||
    normalized.includes('gas required exceeds allowance')
  );
};

export const isGuardianRecoveryNotReadyError = (error: unknown): boolean =>
  getErrorText(error).includes('0x201b632a') ||
  getErrorText(error).includes('PALI_GUARDIAN_RECOVERY_NOT_READY');

/** RecoveryAlreadyScheduled(bytes32) from the guardian recovery module. */
export const isGuardianRecoveryAlreadyScheduledError = (
  error: unknown
): boolean =>
  getErrorText(error).includes('0x684d1639') ||
  getErrorText(error).includes('PALI_GUARDIAN_RECOVERY_ALREADY_SCHEDULED');

/** AA24: the userOp signature was rejected by the account's validator. */
export const isSmartAccountSignatureError = (error: unknown): boolean => {
  const message = getErrorText(error);
  const failedOpReason = getEntryPointFailedOpReason(error);
  return (
    failedOpReason.includes('AA24') ||
    message.includes('AA24') ||
    message.includes('PALI_SMART_ACCOUNT_SIGNATURE_ERROR')
  );
};

/**
 * Raw RPC/revert payloads aren't user-presentable - used to decide
 * between showing the original message and a friendly fallback.
 */
export const isRawRpcRevertMessage = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('"jsonrpc"') ||
    normalized.includes('execution reverted') ||
    normalized.includes('0x220266b6') ||
    normalized.includes('"data":"0x') ||
    normalized.includes('data: 0x')
  );
};

export const getSmartAccountActionErrorMessage = (
  error: unknown,
  fallback: string,
  gasMessage: string
): string => {
  if (isSmartAccountPrefundError(error) || isNativeGasError(error)) {
    return gasMessage;
  }

  const message = (error as any)?.message;
  return message && !isRawRpcRevertMessage(message) ? message : fallback;
};
