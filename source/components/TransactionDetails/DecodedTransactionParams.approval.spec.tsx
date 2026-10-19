/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { DecodedTransactionParams } from './DecodedTransactionParams';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const OPERATOR = `0x${'33'.repeat(20)}`;

it.each(['approve', 'increaseAllowance', 'decreaseAllowance'])(
  'renders the dedicated amount for %s',
  (method) => {
    render(
      <DecodedTransactionParams
        decodedData={
          {
            method,
            inputs: [OPERATOR, '7'],
            names: ['spender', 'amount'],
            types: ['address', 'uint256'],
            approvalType: 'erc20-amount',
          } as any
        }
      />
    );
    expect(screen.getByText('transactions.approvalAmount:')).toBeTruthy();
    expect(screen.getByText('transactions.spender:')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  }
);

it.each([true, false])(
  'renders the dedicated operator approval status when approved=%s',
  (approved) => {
    render(
      <DecodedTransactionParams
        decodedData={
          {
            method: 'setApprovalForAll',
            inputs: [OPERATOR, approved],
            names: ['operator', 'approved'],
            types: ['address', 'bool'],
            approvalType: 'nft-all',
          } as any
        }
      />
    );
    expect(screen.getByText('transactions.operator:')).toBeTruthy();
    expect(screen.getByText('transactions.approvalStatus:')).toBeTruthy();
    expect(
      screen.getByText(
        approved ? '✓ transactions.approved' : '✗ transactions.revoked'
      )
    ).toBeTruthy();
  }
);
