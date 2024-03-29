import { ethErrors, errorCodes } from '.';
import {
  getMessageFromCode,
  JSON_RPC_SERVER_ERROR_MESSAGE,
} from './errorsUtils';
import {
  dummyData,
  CUSTOM_ERROR_MESSAGE,
  SERVER_ERROR_CODE,
  CUSTOM_ERROR_CODE,
} from './testValues';

describe('ethErrors.rpc.invalidInput', () => {
  it('accepts a single string argument where appropriate', () => {
    const err = ethErrors.rpc.invalidInput(CUSTOM_ERROR_MESSAGE);
    expect(err.code).toBe(errorCodes.rpc.invalidInput);
    expect(err.message).toBe(CUSTOM_ERROR_MESSAGE);
  });
});

describe('ethErrors.provider.unauthorized', () => {
  it('accepts a single string argument where appropriate', () => {
    const err = ethErrors.provider.unauthorized(CUSTOM_ERROR_MESSAGE);
    expect(err.code).toBe(errorCodes.provider.unauthorized);
    expect(err.message).toBe(CUSTOM_ERROR_MESSAGE);
  });
});

describe('custom provider error options', () => {
  it('throws if the value is not an options object', () => {
    expect(() => {
      // @ts-expect-error Invalid input
      ethErrors.provider.custom('bar');
    }).toThrow(
      'Ethereum Provider custom errors must provide single object argument.'
    );
  });

  it('throws if the value is invalid', () => {
    expect(() => {
      // @ts-expect-error Invalid input
      ethErrors.provider.custom({ code: 4009, message: 2 });
    }).toThrow('"message" must be a nonempty string');

    expect(() => {
      ethErrors.provider.custom({ code: 4009, message: '' });
    }).toThrow('"message" must be a nonempty string');
  });
});

describe('ethError.rpc.server', () => {
  it('throws on invalid input', () => {
    expect(() => {
      // @ts-expect-error Invalid input
      ethErrors.rpc.server('bar');
    }).toThrow(
      'Ethereum RPC Server errors must provide single object argument.'
    );

    expect(() => {
      // @ts-expect-error Invalid input
      ethErrors.rpc.server({ code: 'bar' });
    }).toThrow('"code" must be an integer such that: -32099 <= code <= -32005');

    expect(() => {
      ethErrors.rpc.server({ code: 1 });
    }).toThrow('"code" must be an integer such that: -32099 <= code <= -32005');
  });
});

describe('ethError.rpc', () => {
  it.each(Object.entries(ethErrors.rpc).filter(([key]) => key !== 'server'))(
    '%s returns appropriate value',
    (key, value) => {
      const createError = value as any;
      const error = createError({
        message: null,
        data: Object.assign({}, dummyData),
      });

      const rpcCode = errorCodes.rpc[key];
      expect(
        Object.values(errorCodes.rpc).includes(error.code) ||
          (error.code <= -32000 && error.code >= -32099)
      ).toBe(true);
      expect(error.code).toBe(rpcCode);
      expect(error.message).toBe(getMessageFromCode(rpcCode));
    }
  );

  it('server returns appropriate value', () => {
    const error = ethErrors.rpc.server({
      code: SERVER_ERROR_CODE,
      data: Object.assign({}, dummyData),
    });

    expect(error.code <= -32000 && error.code >= -32099).toBe(true);
    expect(error.message).toBe(JSON_RPC_SERVER_ERROR_MESSAGE);
  });
});

describe('ethError.provider', () => {
  it.each(
    Object.entries(ethErrors.provider).filter(([key]) => key !== 'custom')
  )('%s returns appropriate value', (key, value) => {
    const createError = value as any;
    const error = createError({
      message: null,
      data: Object.assign({}, dummyData),
    });

    const providerCode = errorCodes.provider[key];
    expect(error.code >= 1000 && error.code < 5000).toBe(true);
    expect(error.code).toBe(providerCode);
    expect(error.message).toBe(getMessageFromCode(providerCode));
  });

  it('custom returns appropriate value', () => {
    const error = ethErrors.provider.custom({
      code: CUSTOM_ERROR_CODE,
      message: CUSTOM_ERROR_MESSAGE,
      data: Object.assign({}, dummyData),
    });
    expect(error.code >= 1000 && error.code < 5000).toBe(true);
    expect(error.code).toBe(CUSTOM_ERROR_CODE);
    expect(error.message).toBe(CUSTOM_ERROR_MESSAGE);
  });
});
