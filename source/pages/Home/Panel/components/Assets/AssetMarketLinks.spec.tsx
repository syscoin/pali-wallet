/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import React from 'react';

import { AssetMarketLinks } from './AssetMarketLinks';

jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
}));

const t = (key: string) => `translated:${key}`;

it.each([{}, { categories: [], id: '' }])(
  'does not add a wrapper or headings when categories and coin links are absent (%j)',
  (marketData) => {
    const view = render(<AssetMarketLinks marketData={marketData} t={t} />);
    expect(view.container.innerHTML).toBe('');
  }
);

it('preserves every category and the existing additional-count label beyond five', () => {
  const categories = [
    'Layer 2 Protocols',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
  ];
  render(<AssetMarketLinks marketData={{ categories }} t={t} />);
  expect(screen.getAllByRole('link')).toHaveLength(6);
  for (const category of categories) {
    const link = screen.getByRole('link', { name: category });
    expect(link.getAttribute('href')).toBe(
      `https://www.coingecko.com/en/categories/${category
        .toLowerCase()
        .replace(/\s+/g, '-')}`
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
  expect(screen.getByText('+1 translated:tokens.more')).toBeTruthy();
  expect(screen.getByText('translated:tokens.categories')).toBeTruthy();
  expect(screen.queryByText('translated:tokens.viewOnCoinGecko')).toBeNull();
});

it('keeps the exact coin and historical links, translations and link identity on rerender', () => {
  const view = render(
    <AssetMarketLinks marketData={{ id: 'syscoin' }} t={t} />
  );
  const tokenName = 'CoinGecko translated:tokens.tokenPage';
  const token = screen.getByRole('link', { name: tokenName });
  const history = screen.getByRole('link', {
    name: 'translated:tokens.historicalData',
  });
  expect(token.getAttribute('href')).toBe(
    'https://www.coingecko.com/en/coins/syscoin'
  );
  expect(history.getAttribute('href')).toBe(
    'https://www.coingecko.com/en/coins/syscoin/historical_data'
  );
  for (const link of [token, history]) {
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
  token.focus();
  view.rerender(
    <AssetMarketLinks
      marketData={{ id: 'syscoin', categories: ['Payments'] }}
      t={t}
    />
  );
  expect(document.activeElement).toBe(token);
  expect(screen.getByRole('link', { name: tokenName })).toBe(token);
  expect(screen.getByText('translated:tokens.viewOnCoinGecko')).toBeTruthy();
});
