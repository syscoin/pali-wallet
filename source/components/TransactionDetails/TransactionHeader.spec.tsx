/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { getEvmTransactionDisplayInfo } from '../../shared/evmTransactionDisplay';
import { defaultAbiCoder, id } from '../../utils/ethersV6Compat';

import { TransactionHeader } from './TransactionHeader';
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it('shows every exact batch collectible quantity and ID from the shared decoder', async () => {
  const to = `0x${'22'.repeat(20)}`,
    from = `0x${'11'.repeat(20)}`;
  const input =
    id(
      'safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)'
    ).slice(0, 10) +
    defaultAbiCoder
      .encode(
        ['address', 'address', 'uint256[]', 'uint256[]', 'bytes'],
        [from, to, [7, 8], [2, 5], '0x']
      )
      .slice(2);
  const displayInfo = await getEvmTransactionDisplayInfo(
    { chainId: 1, to, input, value: '0' },
    'ETH'
  );
  render(
    <TransactionHeader
      txType="Sent"
      statusIcon={null}
      txStatus={null}
      displayInfo={displayInfo}
    />
  );
  expect(screen.getByText('7 NFT')).toBeTruthy();
  expect(screen.getByText('2 NFT #7')).toBeTruthy();
  expect(screen.getByText('5 NFT #8')).toBeTruthy();
  expect(screen.queryByText('0 ETH')).toBeNull();
});
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
