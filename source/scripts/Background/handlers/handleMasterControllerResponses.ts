import { IMasterController } from 'scripts/Background/controllers';
import { extractErrorMessage } from 'utils/index';

const AA21_PREFUND_REASON_HEX =
  '41413231206469646e2774207061792070726566756e64';
const NATIVE_GAS_REQUIRED_ERROR = 'PALI_NATIVE_GAS_REQUIRED';
// Guardian recovery module custom-error selectors. Revert data is dropped
// when errors are flattened to a message string at this boundary, so map
// known selectors to sentinels the UI error helpers recognize.
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_SELECTOR = '0x684d1639';
const GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR =
  'PALI_GUARDIAN_RECOVERY_ALREADY_SCHEDULED';
const GUARDIAN_RECOVERY_NOT_READY_SELECTOR = '0x201b632a';
const GUARDIAN_RECOVERY_NOT_READY_ERROR = 'PALI_GUARDIAN_RECOVERY_NOT_READY';
const GUARDIAN_RECOVERY_EXPIRED_SELECTOR = '0x80ba2533';
const GUARDIAN_RECOVERY_EXPIRED_ERROR = 'PALI_GUARDIAN_RECOVERY_EXPIRED';

const stringifyControllerError = (error: unknown): string => {
  if (!error || typeof error !== 'object') {
    return '';
  }

  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
};

const getControllerErrorText = (error: unknown, depth = 0): string => {
  if (!error || depth > 4) {
    return '';
  }
  if (typeof error === 'string') {
    try {
      return [error, getControllerErrorText(JSON.parse(error), depth + 1)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    } catch {
      return error.toLowerCase();
    }
  }
  if (typeof error !== 'object') {
    return String(error).toLowerCase();
  }

  const errorRecord = error as Record<string, unknown>;
  const parts = [
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
    extractErrorMessage(error, ''),
    stringifyControllerError(error),
    ...Object.getOwnPropertyNames(error)
      .filter((key) => key !== 'stack')
      .map((key) => errorRecord[key]),
  ].flatMap((value) =>
    value ? [getControllerErrorText(value, depth + 1)] : []
  );

  return parts.filter(Boolean).join(' ').toLowerCase();
};

const normalizeControllerErrorMessage = (error: unknown): string => {
  const errorText = getControllerErrorText(error);
  if (
    errorText.includes('aa21') ||
    errorText.includes("didn't pay prefund") ||
    errorText.includes('did not pay prefund') ||
    errorText.includes(AA21_PREFUND_REASON_HEX)
  ) {
    return NATIVE_GAS_REQUIRED_ERROR;
  }
  if (errorText.includes(GUARDIAN_RECOVERY_ALREADY_SCHEDULED_SELECTOR)) {
    return GUARDIAN_RECOVERY_ALREADY_SCHEDULED_ERROR;
  }
  if (errorText.includes(GUARDIAN_RECOVERY_NOT_READY_SELECTOR)) {
    return GUARDIAN_RECOVERY_NOT_READY_ERROR;
  }
  if (errorText.includes(GUARDIAN_RECOVERY_EXPIRED_SELECTOR)) {
    return GUARDIAN_RECOVERY_EXPIRED_ERROR;
  }

  return extractErrorMessage(error, 'Unknown error');
};

export const handleMasterControllerResponses = (
  MasterControllerInstance: IMasterController
) => {
  const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

  chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
    const { type, data } = message;

    try {
      const isEventValid = type === 'CONTROLLER_ACTION';

      if (!isEventValid) {
        return false;
      }

      const { methods, params } = data;
      const senderOrigin = sender.url ? new URL(sender.url).origin : '';
      if (sender.tab && senderOrigin !== extensionOrigin) {
        throw new Error(
          'Controller actions are not available from connected sites'
        );
      }

      let targetMethod = MasterControllerInstance;

      for (const method of methods) {
        if (targetMethod && method in targetMethod) {
          targetMethod = targetMethod[method];
        } else {
          throw new Error('Method not found');
        }
      }

      if (typeof targetMethod === 'function') {
        Promise.resolve()
          .then(async () => {
            // Always execute the method; never attempt to send functions over messaging
            const response = await (targetMethod as any)(...params);
            return response;
          })
          .then(sendResponse)
          .catch((error) => {
            console.error('Error executing method:', error);
            // Preserve structured errors from syscoinjs-lib
            if (
              error &&
              typeof error === 'object' &&
              error.code &&
              error.error === true
            ) {
              // Pass through structured errors as-is
              sendResponse(error);
            } else {
              // For regular errors, wrap in error object
              sendResponse({
                error: normalizeControllerErrorMessage(error),
                success: false,
              });
            }
            return false;
          });

        return true;
      } else {
        throw new Error('Method is not a function');
      }
    } catch (error) {
      console.error('Error in message handler:', error);
      // Preserve structured errors from syscoinjs-lib
      if (
        error &&
        typeof error === 'object' &&
        error.code &&
        error.error === true
      ) {
        // Pass through structured errors as-is
        sendResponse(error);
      } else {
        // For regular errors, wrap in error object
        sendResponse({
          error: normalizeControllerErrorMessage(error),
          success: false,
        });
      }
      return false;
    }
  });
};
