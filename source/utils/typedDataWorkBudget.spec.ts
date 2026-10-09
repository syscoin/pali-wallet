import {
  assertTypedDataParamsWorkBudget,
  assertTypedDataWorkBudget,
} from './typedDataWorkBudget';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const mail = () => ({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person[]' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: { name: 'Ether Mail', chainId: 1 },
  message: {
    from: { name: 'Cow', wallet: ADDRESS },
    to: [{ name: 'Bob', wallet: ADDRESS }],
    contents: 'Hello # Bob',
  },
});

describe('typed-data schema work budget', () => {
  it('accepts nested EIP-712 mail, permits and a fifty-item order without mutation', () => {
    const data = mail();
    const before = JSON.stringify(data);
    expect(() =>
      assertTypedDataParamsWorkBudget('eth_signTypedData_v4', [ADDRESS, before])
    ).not.toThrow();
    expect(() => assertTypedDataWorkBudget(data)).not.toThrow();
    expect(JSON.stringify(data)).toBe(before);
    expect(() =>
      assertTypedDataWorkBudget({
        primaryType: 'Permit',
        domain: {},
        types: {
          Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        message: {
          owner: ADDRESS,
          spender: ADDRESS,
          value: '1000000',
          deadline: '12345678',
        },
      })
    ).not.toThrow();
    data.message.to = Array.from({ length: 50 }, () => ({
      name: 'recipient',
      wallet: ADDRESS,
    }));
    expect(() => assertTypedDataWorkBudget(data)).not.toThrow();
  });

  it('checks parsed JSON and rejects malformed data as invalidParams', () => {
    expect(() =>
      assertTypedDataParamsWorkBudget('eth_signTypedData_v4', [ADDRESS, '{bad'])
    ).toThrow('invalid typed-data JSON');
    try {
      assertTypedDataParamsWorkBudget('eth_signTypedData_v4', [
        ADDRESS,
        '{bad',
      ]);
    } catch (error) {
      expect(error.code).toBe(-32602);
    }
    let deep: any = {};
    for (let i = 0; i < 40; i++) deep = { child: deep };
    expect(() =>
      assertTypedDataParamsWorkBudget('eth_signTypedData_v4', [
        ADDRESS,
        JSON.stringify(deep),
      ])
    ).toThrow('depth');
  });

  it('rejects duplicate field names that amplify validation/hashing of a tiny subtree', () => {
    expect(() =>
      assertTypedDataWorkBudget({
        primaryType: 'A',
        types: {
          A: [
            { name: 'x', type: 'A' },
            { name: 'x', type: 'A' },
          ],
        },
        message: { x: {} },
      })
    ).toThrow('duplicate');
  });

  it('bounds type definitions and total field count', () => {
    expect(() =>
      assertTypedDataWorkBudget({
        types: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [`T${i}`, []])
        ),
      })
    ).toThrow('64');
    expect(() =>
      assertTypedDataWorkBudget({
        types: {
          A: Array.from({ length: 129 }, (_, i) => ({
            name: `f${i}`,
            type: 'string',
          })),
        },
      })
    ).toThrow('128');
    expect(() =>
      assertTypedDataWorkBudget({
        types: Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [
            `T${i}`,
            Array.from({ length: 103 }, (_field, j) => ({
              name: `f${j}`,
              type: 'uint256',
            })),
          ])
        ),
      })
    ).toThrow('512');
  });

  it('counts semantic field expansion even when JSON has few values', () => {
    const fields = Array.from({ length: 128 }, (_, i) => ({
      name: `f${i}`,
      type: 'string',
    }));
    expect(() =>
      assertTypedDataWorkBudget({
        primaryType: 'Batch',
        types: { Batch: [{ name: 'items', type: 'Item[]' }], Item: fields },
        message: { items: Array.from({ length: 33 }, () => ({})) },
      })
    ).toThrow('4096');
  });

  it('counts fixed/multidimensional primitive arrays and domain fields', () => {
    expect(() =>
      assertTypedDataWorkBudget({
        primaryType: 'A',
        types: { A: [{ name: 'items', type: 'uint256[65][65]' }] },
        message: {
          items: Array.from({ length: 65 }, () =>
            Array.from({ length: 65 }, () => 1)
          ),
        },
      })
    ).toThrow('4096');
    expect(() =>
      assertTypedDataWorkBudget({
        primaryType: 'A',
        types: { A: [], EIP712Domain: [{ name: 'items', type: 'uint256[]' }] },
        message: {},
        domain: { items: Array.from({ length: 4097 }, () => 1) },
      })
    ).toThrow('4096');
  });

  it('bounds semantic nesting and dimension declarations separately from JSON depth', () => {
    let value: any = {};
    for (let i = 0; i < 17; i++) value = { x: value };
    expect(() =>
      assertTypedDataWorkBudget({
        primaryType: 'A',
        types: { A: [{ name: 'x', type: 'A' }] },
        message: value,
      })
    ).toThrow('depth 16');
    expect(() =>
      assertTypedDataWorkBudget({
        types: { A: [{ name: 'x', type: `uint256${'[]'.repeat(17)}` }] },
      })
    ).toThrow('depth 16');
  });
});
