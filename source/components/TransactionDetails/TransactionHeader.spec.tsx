/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { TransactionHeader } from './TransactionHeader';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it('does not display guessed raw token units as a human amount when precision is unknown', () => {
  render(
    <TransactionHeader
      txType="Sent"
      statusIcon={null}
      txStatus={null}
      displayInfo={{
        displaySymbol: 'TOK',
        displayValue: '6000000',
        formattedValue: '6000000',
        isNft: false,
        hasUnknownDecimals: true,
      }}
    />
  );
  expect(screen.getByText('? TOK')).toBeTruthy();
  expect(screen.queryByText('6000000 TOK')).toBeNull();
});
it('retains a known ERC-20 amount and NFT identifier', () => {
  const view = render(
    <TransactionHeader
      txType="Sent"
      statusIcon={null}
      txStatus={null}
      displayInfo={{
        displaySymbol: 'TOK',
        displayValue: '6.0',
        formattedValue: '6.0',
        isNft: false,
      }}
    />
  );
  expect(screen.getByText('6.0 TOK')).toBeTruthy();
  view.rerender(
    <TransactionHeader
      txType="Sent"
      statusIcon={null}
      txStatus={null}
      displayInfo={{
        displaySymbol: 'ART',
        displayValue: '1',
        formattedValue: '1',
        isNft: true,
        tokenId: '7',
      }}
    />
  );
  expect(screen.getByText('1 ART #7')).toBeTruthy();
});
