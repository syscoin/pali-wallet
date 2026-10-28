import { Interface } from 'utils/ethersV6Compat';

import {
  canEditApprovalAmount,
  encodeCustomApprovalData,
  formatApprovalNftTokenId,
  formatApprovalTokenAmount,
  getApprovalAddressValues,
  getApprovalAmountDisplay,
  getEffectiveApprovalData,
  parseApprovalAmount,
} from './approval';

const SPENDER = '0x1111111111111111111111111111111111111111';
const ZERO = '0x0000000000000000000000000000000000000000';
const ERC20_ABI = [
  'function approve(address spender,uint256 amount)',
  'function increaseAllowance(address spender,uint256 addedValue)',
  'function decreaseAllowance(address spender,uint256 subtractedValue)',
];

describe('approval editing', () => {
  it('only identifies a valid single-NFT zero-address approval as a revocation', () => {
    const contract = '0x2222222222222222222222222222222222222222';
    const decoded = { method: 'approve', inputs: [ZERO, 0] };
    expect(
      getApprovalAddressValues(decoded, contract, 'erc721-single')
    ).toMatchObject({
      isValid: true,
      isNftRevocation: true,
      authorityLabelKey: 'send.approvalResetAddress',
    });
    expect(formatApprovalNftTokenId(0)).toBe('0');
    expect(formatApprovalNftTokenId('0x0')).toBe('0');
    expect(formatApprovalNftTokenId(undefined)).toBe('');
    expect(formatApprovalNftTokenId(null)).toBe('');
    expect(formatApprovalNftTokenId('  ')).toBe('');
    expect(
      getApprovalAddressValues(
        { ...decoded, inputs: [SPENDER, 0] },
        contract,
        'erc721-single'
      ).isNftRevocation
    ).toBe(false);
    expect(
      getApprovalAddressValues(decoded, contract, 'erc20-amount')
        .isNftRevocation
    ).toBe(false);
    expect(
      getApprovalAddressValues(
        { ...decoded, method: 'transfer' },
        contract,
        'erc721-single'
      ).isNftRevocation
    ).toBe(false);
    expect(
      getApprovalAddressValues(
        { ...decoded, inputs: [ZERO, null] },
        contract,
        'erc721-single'
      ).isNftRevocation
    ).toBe(false);
    expect(
      getApprovalAddressValues(
        { ...decoded, inputs: [ZERO, ''] },
        contract,
        'erc721-single'
      ).isValid
    ).toBe(false);
    expect(
      getApprovalAddressValues(decoded, 'not-a-contract', 'erc721-single')
        .isNftRevocation
    ).toBe(false);
  });
  it('allows custom absolute limits only for plain approve', () => {
    expect(canEditApprovalAmount('erc20-amount', 'approve')).toBe(true);
    expect(canEditApprovalAmount('erc20-amount', 'increaseAllowance')).toBe(
      false
    );
    expect(canEditApprovalAmount('erc20-amount', 'decreaseAllowance')).toBe(
      false
    );
  });

  it('encodes a human-readable custom approve amount without changing methods', () => {
    const encoded = encodeCustomApprovalData({
      abi: ERC20_ABI,
      approvalType: 'erc20-amount',
      decimals: 6,
      humanAmount: '1.5',
      method: 'approve',
      spender: SPENDER,
    });
    const parsed = new Interface(ERC20_ABI).parseTransaction({ data: encoded });

    expect(parsed.name).toBe('approve');
    expect(parsed.args[0]).toBe(SPENDER);
    expect(parsed.args[1].toString()).toBe('1500000');
  });

  it.each(['increaseAllowance', 'decreaseAllowance'])(
    'refuses to rewrite %s as approve',
    (method) => {
      expect(
        encodeCustomApprovalData({
          abi: ERC20_ABI,
          approvalType: 'erc20-amount',
          decimals: 6,
          humanAmount: '1.5',
          method,
          spender: SPENDER,
        })
      ).toBeNull();
    }
  );

  it('formats raw token units for display', () => {
    expect(formatApprovalTokenAmount('1500000', 6)).toBe('1.5');
    expect(formatApprovalTokenAmount('1', 0)).toBe('1');
  });

  it('shows the custom amount instead of the requested unlimited amount', () => {
    expect(
      getApprovalAmountDisplay({
        canEdit: true,
        customAmount: '1.5',
        formattedAmount:
          '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        isCustom: true,
        isEffectiveUnlimited: false,
      })
    ).toEqual({ amount: '1.5', isUnlimited: false });
  });

  it.each(['', '-1', 'NaN', '1e9', '0x10', '1.0000001'])(
    'rejects malformed or nonrepresentable token amount %p',
    (value) => {
      expect(parseApprovalAmount(value, 6)).toBeNull();
    }
  );

  it('accepts exact zero and the uint256 maximum but refuses overflow or invalid decimals', () => {
    const maximum = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
    expect(parseApprovalAmount('0', 18)).toBe(BigInt(0));
    expect(parseApprovalAmount(maximum, 0)?.toString()).toBe(maximum);
    expect(
      parseApprovalAmount((BigInt(maximum) + BigInt(1)).toString(), 0)
    ).toBeNull();
    expect(parseApprovalAmount('1', -1)).toBeNull();
    expect(parseApprovalAmount('1', 1.5)).toBeNull();
  });

  const decodedTx = {
    method: 'approve',
    inputs: [SPENDER, '100000000'],
    names: ['spender', 'amount'],
    types: ['address', 'uint256'],
  };
  const originalData = new Interface(ERC20_ABI).encodeFunctionData(
    'approve',
    decodedTx.inputs
  );

  it('derives the review amount from the exact custom calldata while preserving authority', () => {
    const review = getEffectiveApprovalData({
      approvalType: 'erc20-amount',
      customAmount: '1.5',
      data: originalData,
      decimals: 6,
      decodedTx,
      isCustom: true,
    });
    expect(review).not.toBeNull();
    const encoded = new Interface(ERC20_ABI).decodeFunctionData(
      'approve',
      review!.data
    );
    expect(encoded[0]).toBe(SPENDER);
    expect(encoded[1].toString()).toBe('1500000');
    expect(review!.decodedTx).toEqual({
      ...decodedTx,
      inputs: [SPENDER, encoded[1].toString()],
    });
    expect(decodedTx.inputs[1]).toBe('100000000');
  });

  it('preserves original default and non-approval data without requiring token metadata', () => {
    const review = getEffectiveApprovalData({
      data: originalData,
      decodedTx,
      isCustom: false,
    });
    expect(review).toEqual({ data: originalData, decodedTx });
    expect(review!.decodedTx).toBe(decodedTx);
    expect(
      getEffectiveApprovalData({ data: '0x1234', decodedTx, isCustom: false })
        ?.data
    ).toBe('0x1234');
  });

  it.each([
    { customAmount: '-1', decimals: 6, method: 'approve' },
    { customAmount: '1', decimals: undefined, method: 'approve' },
    { customAmount: null, decimals: 6, method: 'approve' },
    { customAmount: '1', decimals: 6, method: 'increaseAllowance' },
  ])(
    'does not show original calldata as a valid edited transaction for %p',
    (input) => {
      expect(
        getEffectiveApprovalData({
          approvalType: 'erc20-amount',
          customAmount: input.customAmount,
          data: originalData,
          decimals: input.decimals,
          decodedTx: { ...decodedTx, method: input.method },
          isCustom: true,
        })
      ).toBeNull();
    }
  );
});
