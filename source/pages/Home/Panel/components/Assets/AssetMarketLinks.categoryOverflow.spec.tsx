/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';

import en from 'assets/locales/en.json';

import { AssetMarketLinks } from './AssetMarketLinks';

jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
}));

const locale = createInstance();
const t = (key: string) => String(locale.t(key));
const categoryNames = [
  'Payments',
  'Layer 2',
  'Infrastructure',
  'Smart Contracts',
  'Scaling',
  'Interoperability',
  'Governance',
  'Privacy',
];

beforeAll(async () => {
  await locale.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

it.each([0, 1, 5, 6, 8])(
  'does not imply hidden categories when all %i category links are visible',
  (count) => {
    const categories = categoryNames.slice(0, count);
    const view = render(<AssetMarketLinks marketData={{ categories }} t={t} />);

    expect(screen.queryAllByRole('link')).toHaveLength(count);
    for (const category of categories) {
      const link = screen.getByRole('link', { name: category });
      expect(link).toBeVisible();
      expect(link).toHaveAttribute(
        'href',
        `https://www.coingecko.com/en/categories/${category
          .toLowerCase()
          .replace(/\s+/g, '-')}`
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    if (count === 0) {
      expect(view.container).toBeEmptyDOMElement();
      expect(screen.queryByText(t('tokens.categories'))).toBeNull();
    } else {
      expect(screen.getByText(t('tokens.categories'))).toBeVisible();
      const firstLink = screen.getByRole('link', {
        name: categoryNames[0],
      });
      firstLink.focus();
      expect(firstLink).toHaveFocus();
      view.rerender(
        <AssetMarketLinks marketData={{ categories: [...categories] }} t={t} />
      );
      expect(screen.getByRole('link', { name: categoryNames[0] })).toBe(
        firstLink
      );
      expect(firstLink).toHaveFocus();
    }

    // Nothing is collapsed: the additional-count label would double-count
    // categories that already have visible, keyboard-operable links above.
    expect(screen.queryByText(/^\+\d+\s+\S.*$/)).toBeNull();
  }
);
