import { Interface } from 'utils/ethersV6Compat';

import {
  canEditApprovalAmount,
  encodeCustomApprovalData,
  formatApprovalTokenAmount,
  getApprovalAmountDisplay,
} from './approval';

const SPENDER = '0x1111111111111111111111111111111111111111';
const ERC20_ABI = [
  'function approve(address spender,uint256 amount)',
  'function increaseAllowance(address spender,uint256 addedValue)',
  'function decreaseAllowance(address spender,uint256 subtractedValue)',
];

describe('approval editing', () => {
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
        isRequestedUnlimited: true,
      })
    ).toEqual({ amount: '1.5', isUnlimited: false });
  });
});
