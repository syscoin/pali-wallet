import { Json } from '@metamask/utils';
import safeStringify from 'fast-safe-stringify';

import { IEthereumRpcErrorHandlerSerialized } from './types';

/**
 * Error subclass implementing JSON RPC 2.0 errors and Ethereum RPC errors
 * per EIP-1474.
 *
 * Permits any integer error code.
 */
export class EthereumRpcErrorHandler<T extends Json> extends Error {
  public code: number;

  public data?: T;

  constructor(code: number, message: string, data?: T) {
    if (!Number.isInteger(code)) throw new Error('Code must be an integer!');

    if (!message || typeof message !== 'string')
      throw new Error('Message must be a noempty string!');

    super(message);

    this.code = code;

    if (data !== undefined) this.data = data;
  }

  /**
   * Get the error as JSON-serializable object.
   *
   * @returns A plain object with all public class properties.
   */

  serializeEthereumErrorResponse(): IEthereumRpcErrorHandlerSerialized {
    const serializedResponse: IEthereumRpcErrorHandlerSerialized = {
      code: this.code,
      message: this.message,
    };

    if (this.data !== undefined) serializedResponse.data = this.data;

    if (this.stack) serializedResponse.stack = this.stack;

    return serializedResponse;
  }

  /**
   * Get a string representation of the serialized error, omitting any circular
   * references.
   *
   * @returns A string representation of the serialized error.
   */

  toStringMethod(): string {
    return safeStringify(
      this.serializeEthereumErrorResponse(),
      stringifyReplacer,
      2
    );
  }
}

/**
 * Error subclass implementing Ethereum Provider errors per EIP-1193.
 * Permits integer error codes in the [ 1000 <= 4999 ] range.
 */
export class EthereumProviderErrorHandler<
  T extends Json
> extends EthereumRpcErrorHandler<T> {
  /**
   * Create an Ethereum Provider JSON-RPC error.
   *
   * @param code - The JSON-RPC error code. Must be an integer in the
   * `1000 <= n <= 4999` range.
   * @param message - The JSON-RPC error message.
   * @param data - Optional data to include in the error.
   */
  constructor(code: number, message: string, data?: T) {
    if (!isValidEthereumProviderCode(code)) {
      throw new Error(
        'Code must be an integer such that: 1000 <= code >= 4999'
      );
    }

    super(code, message, data);
  }
}

/**
 * Check if the given code is a valid JSON-RPC error code.
 *
 * @param code - The code to check.
 * @returns Whether the code is valid.
 */
function isValidEthereumProviderCode(code: number): boolean {
  return Number.isInteger(code) && code >= 1000 && code <= 4999;
}

/**
 * A JSON replacer function that omits circular references.
 *
 * @param _ - The key being replaced.
 * @param value - The value being replaced.
 * @returns The value to use in place of the original value.
 */
function stringifyReplacer(_: unknown, value: unknown): unknown {
  if (value === '[Circular]') {
    return undefined;
  }

  return value;
}

// function validateErrorCodeToReturnMessage(errorCode: number) {
//   switch (errorCode) {
//     case -32700:
//       return 'Parse error - Invalid JSON';
//     case -32600:
//       return 'Invalid Request - JSON is not a valid request object';
//     case -32601:
//       return 'Method not found - Method does not exist';
//     case -32602:
//       return 'Invalid params - Invalid method parameters';
//     case -32603:
//       return 'Internal error - Interal JSON-RPC error';
//     case -32000:
//       return 'Invalid input - Missing or invalid parameters';
//     case -32001:
//       return 'Resource not found - Requested resource not found';
//     case -32002:
//       return 'Resource unavailabe - Requested resource not available';
//     case -32003:
//       return 'Transaction rejected - Transaction creation failed';
//     case -32004:
//       return 'Method not supported - Method is not implemented';
//     case -32005:
//       return 'Limit exceeded - Request exceeds defined limit';
//     case -32006:
//       return 'JSON-RPC version not supported - Version of JSON-RPC protocol is not supported';
//     default:
//       return 'Invalid transaction';
//   }
// }
// function CustomError(props) {
//   const instance = new Error(props);
//   Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
//   return instance;
// }

// CustomError.prototype = Object.create(Error.prototype, {
//   constructor: {
//     value: Error,
//     enumerable: false,
//     writable: true,
//     configurable: true,
//   },
// });

// if (Object.setPrototypeOf) {
//   Object.setPrototypeOf(CustomError, Error);
// } else {
//   CustomError.__proto__ = Error;
// }
