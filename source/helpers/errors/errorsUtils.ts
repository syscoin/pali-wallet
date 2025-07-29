import { EthereumRpcErrorHandler } from './errorClassesHandlers';
import { errorCodes, errorValues } from './errorConstants';
import { Json } from './types';
import { IEthereumRpcErrorHandlerSerialized } from './types';

const FALLBACK_ERROR_CODE = errorCodes.rpc.internal;
const FALLBACK_MESSAGE =
  'Unspecified error message. This is a bug, please report it.';
const FALLBACK_ERROR: IEthereumRpcErrorHandlerSerialized = {
  code: FALLBACK_ERROR_CODE,
  message: getMessageFromCode(FALLBACK_ERROR_CODE),
};

export const JSON_RPC_SERVER_ERROR_MESSAGE = 'Unspecified server error.';

type ErrorValueKey = keyof typeof errorValues;

type PlainObject = Record<number | string | symbol, unknown>;

/**
 * Check if the value is plain object.
 *
 * @param value - Value to be checked.
 * @returns True if an object is the plain JavaScript object,
 * false if the object is not plain (e.g. function).
 */
export function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  try {
    let proto = value;
    while (Object.getPrototypeOf(proto) !== null) {
      proto = Object.getPrototypeOf(proto);
    }

    return Object.getPrototypeOf(value) === proto;
  } catch (_) {
    return false;
  }
}

/**
 * Gets the message for a given code, or a fallback message if the code has
 * no corresponding message.
 *
 * @param code - The error code.
 * @param fallbackMessage - The fallback message to use if the code has no
 * corresponding message.
 * @returns The message for the given code, or the fallback message if the code
 * has no corresponding message.
 */
export function getMessageFromCode(
  code: number,
  fallbackMessage: string = FALLBACK_MESSAGE
): string {
  if (Number.isInteger(code)) {
    const codeString = code.toString();

    if (Object.hasOwnProperty.call(errorValues, codeString)) {
      return errorValues[codeString as ErrorValueKey].message;
    }

    if (isJsonRpcServerError(code)) {
      return JSON_RPC_SERVER_ERROR_MESSAGE;
    }
  }
  return fallbackMessage;
}

/**
 * Returns whether the given code is valid.
 * A code is only valid if it has a message.
 *
 * @param code - The error code.
 * @returns Whether the given code is valid.
 */
export function isValidCode(code: number): boolean {
  if (!Number.isInteger(code)) {
    return false;
  }

  const codeString = code.toString();
  if (errorValues[codeString as ErrorValueKey]) {
    return true;
  }

  if (isJsonRpcServerError(code)) {
    return true;
  }

  return false;
}

/**
 * Serializes the given error to an Ethereum JSON RPC-compatible error object.
 * Merely copies the given error's values if it is already compatible.
 * If the given error is not fully compatible, it will be preserved on the
 * returned object's data.originalError property.
 *
 * @param error - The error to serialize.
 * @param options - Options bag.
 * @param options.fallbackError - The error to return if the given error is
 * not compatible.
 * @param options.shouldIncludeStack - Whether to include the error's stack
 * on the returned object.
 * @returns The serialized error.
 */
export function serializeError(
  error: unknown,
  { fallbackError = FALLBACK_ERROR, shouldIncludeStack = false } = {}
): IEthereumRpcErrorHandlerSerialized {
  if (
    !fallbackError ||
    !Number.isInteger(fallbackError.code) ||
    typeof fallbackError.message !== 'string'
  ) {
    throw new Error(
      'Must provide fallback error with integer number code and string message.'
    );
  }

  if (error instanceof EthereumRpcErrorHandler) {
    return error.serializeEthereumErrorResponse();
  }

  const serialized: Partial<IEthereumRpcErrorHandlerSerialized> = {};

  if (
    error &&
    isPlainObject(error) &&
    Object.hasOwnProperty.call(error, 'code') &&
    isValidCode((error as IEthereumRpcErrorHandlerSerialized).code)
  ) {
    const _error = error as Partial<IEthereumRpcErrorHandlerSerialized>;
    serialized.code = _error.code as number;

    if (_error.message && typeof _error.message === 'string') {
      serialized.message = _error.message;

      if (Object.hasOwnProperty.call(_error, 'data')) {
        serialized.data = _error.data ?? null;
      }
    } else {
      serialized.message = getMessageFromCode(
        (serialized as IEthereumRpcErrorHandlerSerialized).code
      );

      // Verify that the original error is serializable
      const originalError = assignOriginalError(error);
      try {
        JSON.stringify(originalError);
        serialized.data = { originalError } as Json;
      } catch (e) {
        // If not serializable, convert to a safe format
        const errorLike = originalError as any;
        serialized.data = {
          originalError: {
            message: String(errorLike?.message || 'Unknown error'),
            name: String(errorLike?.name || 'Error'),
            stack: String(errorLike?.stack || ''),
          },
        } as Json;
      }
    }
  } else {
    serialized.code = fallbackError.code;

    const message = (error as any)?.message;

    serialized.message =
      message && typeof message === 'string' ? message : fallbackError.message;

    // Verify that the original error is serializable
    const originalError = assignOriginalError(error);
    try {
      JSON.stringify(originalError);
      serialized.data = { originalError } as Json;
    } catch (e) {
      // If not serializable, convert to a safe format
      const errorLike = originalError as any;
      serialized.data = {
        originalError: {
          message: String(errorLike?.message || 'Unknown error'),
          name: String(errorLike?.name || 'Error'),
          stack: String(errorLike?.stack || ''),
        },
      } as Json;
    }
  }

  const stack = (error as any)?.stack;

  if (shouldIncludeStack && error && stack && typeof stack === 'string') {
    serialized.stack = stack;
  }
  return serialized as IEthereumRpcErrorHandlerSerialized;
}

/**
 * Check if the given code is a valid JSON-RPC server error code.
 *
 * @param code - The error code.
 * @returns Whether the given code is a valid JSON-RPC server error code.
 */
function isJsonRpcServerError(code: number): boolean {
  return code >= -32099 && code <= -32000;
}

/**
 * Create a copy of the given value if it's an object, and not an array.
 *
 * @param error - The value to copy.
 * @returns The copied value, or the original value if it's not an object.
 */
function assignOriginalError(error: unknown): unknown {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    return Object.assign({}, error);
  }

  return error;
}
