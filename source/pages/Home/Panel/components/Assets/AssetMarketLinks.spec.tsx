/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { AssetMarketLinks } from './AssetMarketLinks';

jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
}));

const t = (key: string) => `translated:${key}`;

it.each([null, 7, {}, { toString: null }, ''])(
  'ignores unsupported coin IDs while retaining valid categories (%j)',
  (id) => {
    render(
      <AssetMarketLinks marketData={{ id, categories: ['Payments'] }} t={t} />
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'Payments' }).getAttribute('href')
    ).toBe('https://www.coingecko.com/en/categories/payments');
    expect(screen.queryByText('translated:tokens.viewOnCoinGecko')).toBeNull();
  }
);

it.each([{}, { categories: [], id: '' }])(
  'does not add a wrapper or headings when categories and coin links are absent (%j)',
  (marketData) => {
    const view = render(<AssetMarketLinks marketData={marketData} t={t} />);
    expect(view.container.innerHTML).toBe('');
  }
);

it.each(['Payments', 7, {}, [null, 3, {}]])(
  'ignores malformed optional category data without hiding valid coin links (%j)',
  (categories) => {
    render(
      <AssetMarketLinks marketData={{ categories, id: 'syscoin' }} t={t} />
    );
    expect(screen.queryByText('translated:tokens.categories')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(
      screen
        .getByRole('link', { name: 'translated:tokens.historicalData' })
        .getAttribute('href')
    ).toBe('https://www.coingecko.com/en/coins/syscoin/historical_data');
  }
);

it('filters invalid category members while preserving every valid category link', () => {
  const categories = [
    'Payments',
    null,
    'Layer 2',
    7,
    'Three',
    'Four',
    'Five',
    {},
    'Six',
  ];
  render(<AssetMarketLinks marketData={{ categories }} t={t} />);
  expect(screen.getAllByRole('link')).toHaveLength(6);
  expect(
    screen.getByRole('link', { name: 'Layer 2' }).getAttribute('href')
  ).toBe('https://www.coingecko.com/en/categories/layer-2');
  expect(screen.queryByText(/^\+\d+\s+\S.*$/)).toBeNull();
});

it('preserves every category without a phantom additional-count label beyond five', () => {
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
  expect(screen.queryByText(/^\+\d+\s+\S.*$/)).toBeNull();
  expect(screen.getByText('translated:tokens.categories')).toBeTruthy();
  expect(screen.queryByText('translated:tokens.viewOnCoinGecko')).toBeNull();
});

it('keeps the exact coin and historical links, translations and link identity on rerender', () => {
  const view = render(
    <AssetMarketLinks marketData={{ id: 'syscoin' }} t={t} />
  );
  const tokenName = 'translated:tokens.tokenPage';
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

it('hides a failed decorative logo while retaining the translated, focusable link', () => {
  render(<AssetMarketLinks marketData={{ id: 'syscoin' }} t={t} />);
  const token = screen.getByRole('link', {
    name: 'translated:tokens.tokenPage',
  });
  const logo = token.querySelector('img');
  expect(logo).not.toBeNull();
  expect(logo).toHaveAttribute('alt', '');
  expect(logo).toHaveAttribute('aria-hidden', 'true');
  expect(logo).toBeVisible();
  fireEvent.error(logo!);
  expect(logo).not.toBeVisible();
  expect(
    screen.getByRole('link', { name: 'translated:tokens.tokenPage' })
  ).toBe(token);
  expect(token).toHaveAttribute(
    'href',
    'https://www.coingecko.com/en/coins/syscoin'
  );
  expect(token).toHaveAttribute('target', '_blank');
  expect(token).toHaveAttribute('rel', 'noopener noreferrer');
  token.focus();
  expect(document.activeElement).toBe(token);
});
