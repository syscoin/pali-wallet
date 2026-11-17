import {
  assertDappTypedDataChain,
  assertDappTypedDataValid,
} from './dappTypedDataValidation';

const address = `0x${'11'.repeat(20)}`;
const message = (chainId?: unknown) => ({
  types: {
    EIP712Domain:
      chainId === undefined ? [] : [{ name: 'chainId', type: 'uint256' }],
    Permit: [{ name: 'spender', type: 'address' }],
  },
  domain: chainId === undefined ? {} : { chainId },
  primaryType: 'Permit',
  message: { spender: address },
});
const max = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();

describe.each(['eth_signTypedData_v3', 'eth_signTypedData_v4'])(
  '%s declared domain chain',
  (method) => {
    it.each([1, '1', '01', '0x1', '0x01', '0X01'])(
      'accepts the selected chain encoding %p without rewriting the request',
      (chainId) => {
        const payload = message(chainId);
        const original = JSON.stringify(payload);
        for (const value of [payload, original]) {
          for (const params of [
            [address, value],
            [value, address],
          ])
            expect(() =>
              assertDappTypedDataValid(method, params, 1)
            ).not.toThrow();
        }
        expect(JSON.stringify(payload)).toBe(original);
      }
    );
    it.each([10, '10', '0xa', '9007199254740993', max])(
      'rejects a different declared chain %p',
      (chainId) => {
        expect(() =>
          assertDappTypedDataValid(method, [address, message(chainId)], 1)
        ).toThrow('domain.chainId does not match');
        try {
          assertDappTypedDataValid(
            method,
            [JSON.stringify(message(chainId)), address],
            1
          );
          throw Error('Expected refusal');
        } catch (error) {
          expect(error).toMatchObject({ code: -32602 });
        }
      }
    );
    it.each([
      null,
      true,
      false,
      {},
      [],
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '',
      '-1',
      '-0x1',
      '+1',
      '1e0',
      '1.0',
      ' 1',
      '1 ',
      '0x',
      '0xzz',
      (BigInt(1) << BigInt(256)).toString(),
      `0x1${'0'.repeat(64)}`,
    ])('rejects malformed or out-of-range declared chain %p', (chainId) => {
      expect(() =>
        assertDappTypedDataChain(method, message(chainId), 1)
      ).toThrow('domain.chainId');
    });
    it('compares uint256 values exactly beyond the safe Number range', () => {
      expect(() =>
        assertDappTypedDataValid(
          method,
          [address, message('9007199254740993')],
          '0x20000000000001'
        )
      ).not.toThrow();
      expect(() =>
        assertDappTypedDataValid(method, [address, message(max)], max)
      ).not.toThrow();
      expect(() =>
        assertDappTypedDataValid(
          method,
          [address, message('9007199254740993')],
          '9007199254740992'
        )
      ).toThrow('does not match');
    });
    it('preserves an absent chain and Smart ERC7739 application-domain validation', () => {
      expect(() =>
        assertDappTypedDataValid(method, [address, message()], 1)
      ).not.toThrow();
      expect(() =>
        assertDappTypedDataValid(method, [address, message(10)])
      ).not.toThrow();
    });
    it('rejects a present undefined chain and never invokes a chain accessor', () => {
      const payload = message();
      Object.defineProperty(payload.domain, 'chainId', {
        configurable: true,
        value: undefined,
      });
      expect(() => assertDappTypedDataChain(method, payload, 1)).toThrow(
        'domain.chainId'
      );
      const getter = jest.fn(() => 1);
      Object.defineProperty(payload.domain, 'chainId', {
        configurable: true,
        get: getter,
      });
      expect(() => assertDappTypedDataChain(method, payload, 1)).toThrow(
        'domain.chainId'
      );
      expect(getter).not.toHaveBeenCalled();
    });
  }
);

it('leaves legacy V1 fields unchanged', () => {
  const legacy = [{ name: 'chainId', type: 'uint256', value: '10' }];
  expect(() =>
    assertDappTypedDataValid('eth_signTypedData', [address, legacy], 1)
  ).not.toThrow();
});
