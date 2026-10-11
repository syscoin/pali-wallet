import {
  assertSupportedEvmFees,
  normalizeDappTransaction,
} from './dappTransaction';
import { BigNumber } from './ethersV6Compat';

const from = `0x${'11'.repeat(20)}`;
const to = `0x${'22'.repeat(20)}`;
const transaction = { from, to, value: '0x0' };
export const malformedTransactions: [string, Record<string, unknown>][] = [
  ...[
    'value',
    'gas',
    'gasLimit',
    'gasPrice',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
    'nonce',
    'chainId',
    'type',
  ].flatMap((field) =>
    [
      'invalid',
      '',
      '0x',
      '-1',
      '1.5',
      '1e9',
      null,
      true,
      [],
      { _hex: '0x1' },
      Number.MAX_SAFE_INTEGER + 1,
    ].map(
      (value) =>
        [`${field}: ${JSON.stringify(value)}`, { [field]: value }] as [
          string,
          Record<string, unknown>
        ]
    )
  ),
  ['overflow', { value: `0x1${'0'.repeat(64)}` }],
  ['zero gas', { gas: '0x0' }],
  ['gas aliases', { gas: '0x5208', gasLimit: '0x5209' }],
  ['fee combination', { gasPrice: '0x1', maxFeePerGas: '0x2' }],
  ['priority above max', { maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x2' }],
  ['legacy fee mismatch', { type: '0x0', maxFeePerGas: '0x2' }],
  ['1559 fee mismatch', { type: '0x2', gasPrice: '0x1' }],
  ['invalid from', { from: 'invalid' }],
  ['array from', { from: [from] }],
  ['invalid to', { to: 'invalid' }],
  ['empty to', { to: '' }],
  ['plaintext data', { data: 'invalid' }],
  ['odd-byte data', { data: '0x0' }],
  ['invalid input', { input: 'invalid' }],
  ['data aliases', { data: '0x00', input: '0x01' }],
  ['access list shape', { accessList: {} }],
  [
    'access list address',
    { accessList: [{ address: 'invalid', storageKeys: [] }] },
  ],
  ['access list key', { accessList: [{ address: to, storageKeys: ['0x0'] }] }],
  ['legacy access list', { type: '0x0', accessList: [] }],
];

describe('dapp transaction admission', () => {
  it.each(malformedTransactions)(
    'rejects %s without defaulting it',
    (_, fields) => {
      expect(() =>
        normalizeDappTransaction({ ...transaction, ...fields })
      ).toThrow(expect.objectContaining({ code: -32602 }));
    }
  );
  it.each([null, undefined, [], 'invalid'])(
    'rejects invalid transaction container %p',
    (value) => {
      expect(() => normalizeDappTransaction(value)).toThrow(
        expect.objectContaining({ code: -32602 })
      );
    }
  );
  it.each(['0x1', '0x3', '0x4', '0x5'])(
    'rejects unsupported transaction type %s explicitly',
    (type) => {
      expect(() => normalizeDappTransaction({ ...transaction, type })).toThrow(
        expect.objectContaining({ code: 4200 })
      );
    }
  );
  it.each([
    'authorizationList',
    'blobVersionedHashes',
    'blobs',
    'maxFeePerBlobGas',
  ])('rejects unsupported %s explicitly', (field) => {
    expect(() =>
      normalizeDappTransaction({ ...transaction, [field]: [] })
    ).toThrow(expect.objectContaining({ code: 4200 }));
  });
  it.each([0, '0', '0x00', '0x0', 42, '42', '0x002a'])(
    'preserves exact compatible value %p',
    (value) => {
      const result = normalizeDappTransaction({ ...transaction, value });
      expect(BigInt(result.value)).toBe(BigInt(value));
      expect(result.data).toBe('0x');
    }
  );
  it('preserves large exact quantities without number conversion', () => {
    const value = (BigInt(1) << BigInt(255)).toString();
    expect(normalizeDappTransaction({ ...transaction, value }).value).toBe(
      `0x${(BigInt(1) << BigInt(255)).toString(16)}`
    );
  });
  it('normalizes hex prefixes before the existing calldata/address formatters', () => {
    const input = {
      from: `0X${'11'.repeat(20)}`,
      to: `0X${'22'.repeat(20)}`,
      input: '0XABCD',
      accessList: [
        {
          address: `0X${'22'.repeat(20)}`,
          storageKeys: [`0X${'33'.repeat(32)}`],
        },
      ],
    };
    expect(normalizeDappTransaction(input)).toMatchObject({
      from,
      to,
      data: '0xABCD',
      accessList: [{ address: to, storageKeys: [`0x${'33'.repeat(32)}`] }],
    });
    expect(input.input).toBe('0XABCD');
    expect(input.accessList[0].address).toBe(`0X${'22'.repeat(20)}`);
  });
  it.each(['maxFeePerGas', 'maxPriorityFeePerGas'])(
    'refuses unsupported zero %s rather than silently changing transaction type/fees',
    (field) => {
      for (const zero of [
        0,
        '0',
        '0x0',
        BigNumber.from(0),
        JSON.parse(JSON.stringify(BigNumber.from(0))),
      ]) {
        expect(() => assertSupportedEvmFees({ [field]: zero })).toThrow(
          expect.objectContaining({ code: 4200 })
        );
      }
      expect(() =>
        normalizeDappTransaction({ ...transaction, [field]: '0x0' })
      ).toThrow(expect.objectContaining({ code: 4200 }));
    }
  );
  it('accepts exact positive BigNumber fees after the popup-to-background JSON round trip', () => {
    const fees = JSON.parse(
      JSON.stringify({
        maxFeePerGas: BigNumber.from('50000000000'),
        maxPriorityFeePerGas: BigNumber.from('10000000000'),
      })
    );
    expect(() => assertSupportedEvmFees(fees)).not.toThrow();
    expect(fees.maxFeePerGas.hex).toBe(
      BigNumber.from('50000000000').toHexString()
    );
  });
  it('normalizes aliases and legacy zero gas price without changing caller input', () => {
    const input = {
      ...transaction,
      input: '0x00',
      gas: 21000,
      gasLimit: '0x5208',
      gasPrice: 0,
    };
    const result = normalizeDappTransaction(input);
    expect(result).toMatchObject({
      data: '0x00',
      gas: '0x5208',
      gasLimit: '0x5208',
      gasPrice: '0x0',
    });
    expect(result.input).toBeUndefined();
    expect(input.input).toBe('0x00');
    expect(input.gas).toBe(21000);
  });
  it.each([undefined, null, to, 'Example.eth', '🚀.eth'])(
    'preserves creation, address or ENS recipient %p',
    (recipient) => {
      expect(normalizeDappTransaction({ to: recipient }).to).toBe(recipient);
    }
  );
  it('preserves ordered duplicate access-list entries/keys', () => {
    const key = `0x${'33'.repeat(32)}`;
    const entry = { address: to, storageKeys: [key, key] };
    const accessList = [entry, entry];
    expect(
      normalizeDappTransaction({ ...transaction, type: '0x2', accessList })
        .accessList
    ).toEqual(accessList);
  });
  it.each([0, '0', '0x00', '0x0'])(
    'normalizes legacy type %p for approval handling',
    (type) => {
      expect(normalizeDappTransaction({ ...transaction, type }).type).toBe(
        '0x0'
      );
    }
  );
});
