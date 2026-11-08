import { DAPP_REQUEST_LIMITS } from '../utils/requestPayloadBudget';

import {
  isDappMessageMethod,
  matchesDappMessageRequest,
  readDappMessageRequest,
} from './dappMessageRequest';

const address = '0x1111111111111111111111111111111111111111';
const otherAddress = '0x2222222222222222222222222222222222222222';
const typedData = () => ({
  types: { Mail: [{ name: 'contents', type: 'string' }] },
  primaryType: 'Mail',
  domain: {},
  message: { contents: 'hello' },
});

it.each([
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
])('recognizes the supported %s method', (method) =>
  expect(isDappMessageMethod(method)).toBe(true)
);

it.each([undefined, null, 'eth_sign', 'eth_sendTransaction', {}, 1])(
  'refuses an unrelated method %p',
  (method) => {
    expect(isDappMessageMethod(method)).toBe(false);
    expect(
      readDappMessageRequest(method, [address, typedData()], address)
    ).toBeUndefined();
  }
);

it.each([
  ['hello', address],
  [address, 'hello'],
])('preserves supported personal message ordering %p', (...params) => {
  const request = readDappMessageRequest('personal_sign', params, address)!;
  expect(request).toEqual({
    method: 'personal_sign',
    address,
    message: 'hello',
  });
  expect(
    matchesDappMessageRequest(request, [
      { 0: address, 1: 'hello', eventName: 'personal_sign' },
    ])
  ).toBe(true);
  expect(
    matchesDappMessageRequest(request, [{ 0: address, 1: 'changed' }])
  ).toBe(false);
});

it('keeps canonical ordering when both personal message parameters look like addresses', () => {
  const request = readDappMessageRequest(
    'personal_sign',
    [otherAddress, address],
    address
  )!;
  expect(request).toEqual({
    method: 'personal_sign',
    address,
    message: otherAddress,
  });
  expect(
    readDappMessageRequest(
      'personal_sign',
      [otherAddress, address],
      otherAddress
    )
  ).toBeUndefined();
});

it.each(['0x0', '0xzz'])(
  'rejects malformed personal message bytes %s',
  (message) => {
    expect(
      readDappMessageRequest('personal_sign', [message, address], address)
    ).toBeUndefined();
  }
);

it.each([
  ['eth_signTypedData', 'V1'],
  ['eth_signTypedData_v3', 'V3'],
  ['eth_signTypedData_v4', 'V4'],
])(
  'captures both parameter orders and JSON representations for %s',
  (method, version) => {
    const payload =
      method === 'eth_signTypedData'
        ? [{ name: 'contents', type: 'string', value: 'hello' }]
        : typedData();
    for (const data of [payload, JSON.stringify(payload)]) {
      for (const params of [
        [address, data],
        [data, address],
      ]) {
        const request = readDappMessageRequest(method, params, address)!;
        expect(request).toEqual({
          method,
          address,
          typedData: payload,
          version,
        });
        expect(
          matchesDappMessageRequest(request, [address, payload, version])
        ).toBe(true);
        expect(
          matchesDappMessageRequest(request, [otherAddress, payload, version])
        ).toBe(false);
        expect(
          matchesDappMessageRequest(request, [address, payload, 'V0'])
        ).toBe(false);
        expect(
          matchesDappMessageRequest(request, [
            address,
            payload,
            version,
            'extra',
          ])
        ).toBe(false);
      }
    }
  }
);

it('detaches and freezes the reviewed data and rejects payload changes', () => {
  const data = typedData();
  const request = readDappMessageRequest(
    'eth_signTypedData_v4',
    [address, data],
    address
  )!;
  data.message.contents = 'changed after capture';
  expect(matchesDappMessageRequest(request, [address, data, 'V4'])).toBe(false);
  expect(matchesDappMessageRequest(request, [address, typedData(), 'V4'])).toBe(
    true
  );
  if (request.method === 'personal_sign')
    throw new Error('Expected typed request');
  expect(Object.isFrozen(request.typedData)).toBe(true);
  expect(
    Object.isFrozen((request.typedData as ReturnType<typeof typedData>).message)
  ).toBe(true);
});

it.each([
  ['eth_signTypedData', []],
  ['eth_signTypedData', [{ name: 'value', type: 'uint256' }]],
  ['eth_signTypedData_v4', []],
  ['eth_signTypedData_v3', '{broken'],
  ['eth_signTypedData_v4', null],
])('rejects malformed %s payloads', (method, data) => {
  expect(
    readDappMessageRequest(method, [address, data], address)
  ).toBeUndefined();
});

it('refuses oversized data and accessor properties before evaluating them', () => {
  const data = typedData();
  data.message.contents = 'x'.repeat(DAPP_REQUEST_LIMITS.signingBytes);
  expect(
    readDappMessageRequest('eth_signTypedData_v4', [address, data], address)
  ).toBeUndefined();
  const getter = jest.fn(() => typedData());
  const params = [address];
  Object.defineProperty(params, '1', { enumerable: true, get: getter });
  expect(
    readDappMessageRequest('eth_signTypedData_v4', params, address)
  ).toBeUndefined();
  expect(getter).not.toHaveBeenCalled();
});
