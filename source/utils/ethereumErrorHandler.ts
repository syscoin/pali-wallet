export interface EthereumErrorHandler extends Error {
  code: number;
  data?: any;
}

export class EthereumErrorHandler extends Error {
  constructor(props) {
    super(props);
    this.message = validateErrorCodeToReturnMessage(props.code);
    this.name = props.name;
    this.code = props.code;
    this.data = props.data;
  }
}

function validateErrorCodeToReturnMessage(errorCode: number) {
  switch (errorCode) {
    case -32700:
      return 'Parse error - Invalid JSON';
    case -32600:
      return 'Invalid Request - JSON is not a valid request object';
    case -32601:
      return 'Method not found - Method does not exist';
    case -32602:
      return 'Invalid params - Invalid method parameters';
    case -32603:
      return 'Internal error - Interal JSON-RPC error';
    case -32000:
      return 'Invalid input - Missing or invalid parameters';
    case -32001:
      return 'Resource not found - Requested resource not found';
    case -32002:
      return 'Resource unavailabe - Requested resource not available';
    case -32003:
      return 'Transaction rejected - Transaction creation failed';
    case -32004:
      return 'Method not supported - Method is not implemented';
    case -32005:
      return 'Limit exceeded - Request exceeds defined limit';
    case -32006:
      return 'JSON-RPC version not supported - Version of JSON-RPC protocol is not supported';
    default:
      return 'Invalid transaction';
  }
}

function CustomError(props) {
  const instance = new Error(props);
  Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
  return instance;
}

CustomError.prototype = Object.create(Error.prototype, {
  constructor: {
    value: Error,
    enumerable: false,
    writable: true,
    configurable: true,
  },
});

if (Object.setPrototypeOf) {
  Object.setPrototypeOf(CustomError, Error);
} else {
  CustomError.__proto__ = Error;
}
