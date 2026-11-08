import { defaultAbiCoder } from '../ethersV6Compat.ts';
const ENTRYPOINT_FAILED_OP_SELECTOR = '0x220266b6';
const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';

export const stringifyError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

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
  ].flatMap((value) => (value ? [getErrorText(value, depth + 1)] : []));

  return parts.filter(Boolean).join(' ');
};

export const getEntryPointFailedOpReason = (error: unknown): string => {
  const message = getErrorText(error);
  const match = message.match(
    new RegExp(`${ENTRYPOINT_FAILED_OP_SELECTOR}[0-9a-fA-F]*`)
  );
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

export const hasNativeGasFailure = (error: unknown): boolean => {
  const message = getErrorText(error);
  const failedOpReason = getEntryPointFailedOpReason(error);
  const normalized = message.toLowerCase();
  const normalizedFailedOpReason = failedOpReason.toLowerCase();

  return (
    message.includes('OutOfNativeResourcesDuringValidation') ||
    normalized.includes(AA21_PREFUND_REASON_HEX) ||
    normalizedFailedOpReason.includes('aa21') ||
    normalizedFailedOpReason.includes("didn't pay prefund") ||
    normalizedFailedOpReason.includes('did not pay prefund') ||
    normalizedFailedOpReason.includes('prefund') ||
    normalized.includes('lackoffund') ||
    normalized.includes('lack of fund') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient balance') ||
    (normalized.includes('maxfee') && normalized.includes('fund')) ||
    normalized.includes('not enough native') ||
    normalized.includes('gas required exceeds allowance')
  );
};

export const hasSmartAccountSignatureFailure = (error: unknown): boolean => {
  const message = getErrorText(error);
  const failedOpReason = getEntryPointFailedOpReason(error);

  return failedOpReason.includes('AA24') || message.includes('AA24');
};

export const hasGuardianRecoveryNotReadyRevert = (error: unknown): boolean =>
  getErrorText(error).includes('0x201b632a');
export const hasGuardianRecoveryAlreadyScheduledRevert = (
  error: unknown
): boolean => getErrorText(error).includes('0x684d1639');
export const hasGuardianRecoveryExpiredRevert = (error: unknown): boolean =>
  getErrorText(error).includes('0x80ba2533');
