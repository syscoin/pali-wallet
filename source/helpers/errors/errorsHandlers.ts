import {
  EthereumRpcErrorHandler,
  EthereumProviderErrorHandler,
} from './errorClassesHandlers';
import { errorCodes } from './errorConstants';
import { getMessageFromCode } from './errorsUtils';
import { Json } from './types';

type EthereumErrorOptions<T extends Json> = {
  data?: T;
  message?: string;
};

type ServerErrorOptions<T extends Json> = {
  code: number;
} & EthereumErrorOptions<T>;

type CustomErrorArg<T extends Json> = ServerErrorOptions<T>;

type EthErrorsArg<T extends Json> = EthereumErrorOptions<T> | string;

export const ethErrors = {
  rpc: {
    /**
     * Get a JSON RPC 2.0 Parse (-32700) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    parse: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.parse, arg),

    /**
     * Get a JSON RPC 2.0 Invalid Request (-32600) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    invalidRequest: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.invalidRequest, arg),

    /**
     * Get a JSON RPC 2.0 Invalid Params (-32602) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    invalidParams: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.invalidParams, arg),

    /**
     * Get a JSON RPC 2.0 Method Not Found (-32601) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    methodNotFound: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.methodNotFound, arg),

    /**
     * Get a JSON RPC 2.0 Internal (-32603) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    internal: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.internal, arg),

    /**
     * Get a JSON RPC 2.0 Server error.
     * Permits integer error codes in the [ -32099 <= -32005 ] range.
     * Codes -32000 through -32004 are reserved by EIP-1474.
     *
     * @param opts - The error options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    server: <T extends Json>(opts: ServerErrorOptions<T>) => {
      if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
        throw new Error(
          'Ethereum RPC Server errors must provide single object argument.'
        );
      }
      const { code } = opts;
      if (!Number.isInteger(code) || code > -32005 || code < -32099) {
        throw new Error(
          '"code" must be an integer such that: -32099 <= code <= -32005'
        );
      }
      return getEthJsonRpcError(code, opts);
    },

    /**
     * Get an Ethereum JSON RPC Invalid Input (-32000) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    invalidInput: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.invalidInput, arg),

    /**
     * Get an Ethereum JSON RPC Resource Not Found (-32001) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    resourceNotFound: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.resourceNotFound, arg),

    /**
     * Get an Ethereum JSON RPC Resource Unavailable (-32002) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    resourceUnavailable: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.resourceUnavailable, arg),

    /**
     * Get an Ethereum JSON RPC Transaction Rejected (-32003) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    transactionRejected: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.transactionRejected, arg),

    /**
     * Get an Ethereum JSON RPC Method Not Supported (-32004) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    methodNotSupported: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.methodNotSupported, arg),

    /**
     * Get an Ethereum JSON RPC Limit Exceeded (-32005) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumRpcErrorHandler} class.
     */
    limitExceeded: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthJsonRpcError(errorCodes.rpc.limitExceeded, arg),
  },

  provider: {
    /**
     * Get an Ethereum Provider User Rejected Request (4001) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumProviderErrorHandler} class.
     */
    userRejectedRequest: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthProviderError(errorCodes.provider.userRejectedRequest, arg),

    /**
     * Get an Ethereum Provider Unauthorized (4100) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumProviderErrorHandler} class.
     */
    unauthorized: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthProviderError(errorCodes.provider.unauthorized, arg),

    /**
     * Get an Ethereum Provider Unsupported Method (4200) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumProviderErrorHandler} class.
     */
    unsupportedMethod: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthProviderError(errorCodes.provider.unsupportedMethod, arg),

    /**
     * Get an Ethereum Provider Not Connected (4900) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumProviderErrorHandler} class.
     */
    disconnected: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthProviderError(errorCodes.provider.disconnected, arg),

    /**
     * Get an Ethereum Provider Chain Not Connected (4901) error.
     *
     * @param arg - The error message or options bag.
     * @returns An instance of the {@link EthereumProviderErrorHandler} class.
     */
    chainDisconnected: <T extends Json>(arg?: EthErrorsArg<T>) =>
      getEthProviderError(errorCodes.provider.chainDisconnected, arg),

    /**
     * Get a custom Ethereum Provider error.
     *
     * @param opts - The error options bag.
     * @returns An instance of the {@link EthereumProviderErrorHandler} class.
     */
    custom: <T extends Json>(opts: CustomErrorArg<T>) => {
      if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
        throw new Error(
          'Ethereum Provider custom errors must provide single object argument.'
        );
      }

      const { code, message, data } = opts;

      if (!message || typeof message !== 'string') {
        throw new Error('"message" must be a nonempty string');
      }
      return new EthereumProviderErrorHandler(code, message, data);
    },
  },
};

/**
 * Get an Ethereum JSON-RPC error class instance.
 *
 * @param code - The error code.
 * @param arg - The error message or options bag.
 * @returns An instance of the {@link EthereumRpcErrorHandler} class.
 */
function getEthJsonRpcError<T extends Json>(
  code: number,
  arg?: EthErrorsArg<T>
): EthereumRpcErrorHandler<T> {
  const [message, data] = parseOpts(arg);
  return new EthereumRpcErrorHandler(
    code,
    message || getMessageFromCode(code),
    data
  );
}

/**
 * Get an Ethereum Provider error class instance.
 *
 * @param code - The error code.
 * @param arg - The error message or options bag.
 * @returns An instance of the {@link EthereumProviderErrorHandler} class.
 */
function getEthProviderError<T extends Json>(
  code: number,
  arg?: EthErrorsArg<T>
): EthereumProviderErrorHandler<T> {
  const [message, data] = parseOpts(arg);
  return new EthereumProviderErrorHandler(
    code,
    message || getMessageFromCode(code),
    data
  );
}

/**
 * Get an error message and optional data from an options bag.
 *
 * @param arg - The error message or options bag.
 * @returns A tuple containing the error message and optional data.
 */
function parseOpts<T extends Json>(
  arg?: EthErrorsArg<T>
): [message?: string | undefined, data?: T | undefined] {
  if (arg) {
    if (typeof arg === 'string') {
      return [arg];
    } else if (typeof arg === 'object' && !Array.isArray(arg)) {
      const { message, data } = arg;

      if (message && typeof message !== 'string') {
        throw new Error('Must specify string message.');
      }
      return [message || undefined, data];
    }
  }

  return [];
}
