/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { Interface } from 'utils/ethersV6Compat';
import { decodeTransactionData } from 'utils/ethUtil';
import { ellipsis } from 'utils/format';

import { DecodedTransactionParams } from './DecodedTransactionParams';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ content, children }: any) => (
    <span data-testid="parameter-tooltip" data-content={String(content)}>
      {children}
    </span>
  ),
}));
jest.mock('utils/index', () => ({
  ellipsis: jest.requireActual('utils/format').ellipsis,
}));

const RECIPIENT = `0x${'33'.repeat(20)}`;
const CONTRACT = `0x${'44'.repeat(20)}`;
const MAXIMUM =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const ABI = [
  'function transfer(address to,uint256 value)',
  'function approve(address spender,uint256 amount)',
  'function increaseAllowance(address spender,uint256 amount)',
  'function decreaseAllowance(address spender,uint256 amount)',
];

const decode = (method: string, amount: string) =>
  decodeTransactionData(
    {
      from: `0x${'11'.repeat(20)}`,
      to: CONTRACT,
      data: new Interface(ABI).encodeFunctionData(method, [RECIPIENT, amount]),
    },
    { call: async () => `0x${'0'.repeat(64)}` },
    {
      getErc20Abi: async () => ABI,
      getErc721Abi: async () => [
        'function supportsInterface(bytes4) view returns (bool)',
      ],
      getErc1155Abi: async () => [
        'function supportsInterface(bytes4) view returns (bool)',
      ],
    }
  );

it.each(['0', '17', '123456789012345678901', MAXIMUM])(
  'keeps decoded transfer integer %s exact in its tooltip and non-symbolic',
  async (amount) => {
    const decoded = await decode('transfer', amount);
    expect(decoded?.inputs[1]).toBe(amount);
    render(<DecodedTransactionParams decodedData={decoded} />);
    const tooltip = screen
      .getAllByTestId('parameter-tooltip')
      .find((node) => node.getAttribute('data-content') === amount);
    expect(tooltip).toBeDefined();
    expect(tooltip!.textContent).toBe(
      amount.length > 20 ? ellipsis(amount, 10, 4) : amount
    );
    expect(screen.queryByText('transactions.unlimited')).toBeNull();
  }
);

describe.each(['approve', 'increaseAllowance', 'decreaseAllowance'])(
  '%s approval semantics',
  (method) => {
    it.each(['17', MAXIMUM])(
      'retains the dedicated approval amount %s',
      async (amount) => {
        const decoded = await decode(method, amount);
        expect(decoded).toMatchObject({ approvalType: 'erc20-amount' });
        render(<DecodedTransactionParams decodedData={decoded} />);
        expect(screen.getByText('transactions.approvalAmount:')).toBeTruthy();
        expect(
          screen.getByText(
            amount === MAXIMUM ? '⚠️ transactions.unlimited' : amount
          )
        ).toBeTruthy();
      }
    );
  }
);
