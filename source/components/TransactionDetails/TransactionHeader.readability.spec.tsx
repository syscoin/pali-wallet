/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';

import { TransactionHeader } from './TransactionHeader';

// Preserve exact text and DOM contracts. The companion ordinary Activity
// browser regression checks actual full-ID glyph containment and navigation.
type HeaderProps = React.ComponentProps<typeof TransactionHeader>;
type DisplayInfo = NonNullable<HeaderProps['displayInfo']>;
type Locale = 'en' | 'fr' | 'de';
type HeaderCase = {
  displayInfo: HeaderProps['displayInfo'];
  expected: string;
  isLoading?: boolean;
  locale?: Locale;
  name: string;
};

const resources = { en, fr, de };
const MAX_UINT256 =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';
const LARGE_QUANTITY = '9007199254740993';
const ICON_NAME = 'Synthetic transaction icon';
const STATUS_TEXT = 'Synthetic confirmed state';
const displayInfo = (overrides: Partial<DisplayInfo> = {}): DisplayInfo => ({
  displaySymbol: 'AX721',
  displayValue: 1,
  formattedValue: '1',
  isNft: true,
  tokenId: '7',
  ...overrides,
});

const cases: HeaderCase[] = [
  { name: 'null display info', displayInfo: null, expected: '...' },
  {
    name: 'null display info while details load',
    displayInfo: null,
    expected: '...',
    isLoading: true,
  },
  {
    name: 'short ordinary native amount',
    displayInfo: displayInfo({
      displaySymbol: 'TSYS',
      isNft: false,
      tokenId: undefined,
    }),
    expected: '1 TSYS',
  },
  {
    name: 'full precision ordinary native amount',
    displayInfo: displayInfo({
      displaySymbol: 'TSYS',
      displayValue: 1,
      formattedValue: '1.000000000000000001',
      isNft: false,
      tokenId: undefined,
    }),
    expected: '1.000000000000000001 TSYS',
  },
  {
    name: 'formatted value rather than the numeric projection',
    displayInfo: displayInfo({
      displaySymbol: 'ART',
      displayValue: '999',
      formattedValue: '0.000000000000000001',
      isNft: false,
      tokenId: undefined,
    }),
    expected: '0.000000000000000001 ART',
  },
  {
    name: 'existing zero fallback when formatted value is missing',
    displayInfo: displayInfo({
      displaySymbol: 'ART',
      displayValue: '999',
      formattedValue: undefined,
      isNft: false,
      tokenId: undefined,
    }),
    expected: '0 ART',
  },
  {
    name: 'short ERC721 identifier',
    displayInfo: displayInfo(),
    expected: '1 AX721 #7',
  },
  {
    name: 'zero string identifier with French transaction-type text',
    displayInfo: displayInfo({ tokenId: '0' }),
    expected: '1 AX721 #0',
    locale: 'fr',
  },
  {
    name: 'full uint256 identifier while details load',
    displayInfo: displayInfo({ tokenId: MAX_UINT256 }),
    expected: '1 AX721 #' + MAX_UINT256,
    isLoading: true,
  },
  {
    name: 'exact ERC1155 quantity beyond Number precision',
    displayInfo: displayInfo({
      displaySymbol: 'AX1155',
      displayValue: LARGE_QUANTITY,
      formattedValue: LARGE_QUANTITY,
    }),
    expected: LARGE_QUANTITY + ' AX1155 #7',
  },
  {
    name: 'exact quantity and full uint256 ID with German type text',
    displayInfo: displayInfo({
      displaySymbol: 'AX1155',
      displayValue: LARGE_QUANTITY,
      formattedValue: LARGE_QUANTITY,
      tokenId: MAX_UINT256,
    }),
    expected: LARGE_QUANTITY + ' AX1155 #' + MAX_UINT256,
    locale: 'de',
  },
  {
    name: 'NFT with no identifier',
    displayInfo: displayInfo({
      displaySymbol: 'NFT',
      tokenId: undefined,
    }),
    expected: '1 NFT',
  },
  {
    name: 'NFT with an empty identifier',
    displayInfo: displayInfo({ displaySymbol: 'NFT', tokenId: '' }),
    expected: '1 NFT',
  },
  {
    name: 'non-NFT ignores a supplied identifier',
    displayInfo: displayInfo({
      displaySymbol: 'ART',
      displayValue: 2,
      formattedValue: '2',
      isNft: false,
    }),
    expected: '2 ART',
  },
];

afterEach(cleanup);

const show = async (
  info: HeaderProps['displayInfo'],
  isLoading = false,
  locale: Locale = 'en'
) => {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    initImmediate: false,
    lng: locale,
    fallbackLng: 'en',
    react: { useSuspense: false },
    resources: Object.fromEntries(
      Object.entries(resources).map(([language, translation]) => [
        language,
        { translation },
      ])
    ),
  });
  const before = JSON.stringify(info);
  const rendered = render(
    <I18nextProvider i18n={instance}>
      <TransactionHeader
        displayInfo={info}
        isLoading={isLoading}
        statusIcon={<span role="img" aria-label={ICON_NAME} />}
        txStatus={<span role="status">{STATUS_TEXT}</span>}
        txType="Received"
      />
    </I18nextProvider>
  );
  return { ...rendered, before, instance };
};

it.each(cases)('preserves $name exactly', async (entry) => {
  const locale = entry.locale ?? 'en';
  const { before, container, instance } = await show(
    entry.displayInfo,
    entry.isLoading ?? false,
    locale
  );
  const value = screen.getByText(entry.expected, { exact: true });
  const type = screen.getByText(resources[locale].send.received, {
    exact: true,
  });
  const icon = screen.getByRole('img', { name: ICON_NAME });
  const status = screen.getByRole('status');

  // Text identity is literal: do not let normalized matching conceal a rounded
  // value, missing #0, omitted quantity, inserted ellipsis or changed spacing.
  expect(value.tagName).toBe('P');
  expect(value.textContent).toBe(entry.expected);
  expect(value).toHaveClass('text-white', 'text-base');
  expect(type.tagName).toBe('P');
  expect(type).toHaveClass('text-brand-gray200', 'text-xs', 'font-light');
  expect(type.textContent).toBe(resources[locale].send.received);
  expect(status.textContent).toBe(STATUS_TEXT);
  expect(icon).toHaveAccessibleName(ICON_NAME);

  const following = Node.DOCUMENT_POSITION_FOLLOWING;
  expect(icon.compareDocumentPosition(type) & following).toBe(following);
  expect(type.compareDocumentPosition(value) & following).toBe(following);
  expect(value.compareDocumentPosition(status) & following).toBe(following);
  expect(container.querySelectorAll('.animate-spin')).toHaveLength(
    entry.isLoading ? 1 : 0
  );
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(JSON.stringify(entry.displayInfo)).toBe(before);
  expect(instance.language).toBe(locale);
});

// This style contract does not substitute JSDOM geometry for the companion
// browser regression's real short/long glyph and rendered-screen checks.
it('constrains the full identifier without adding truncation or a new control', async () => {
  const info = displayInfo({ tokenId: MAX_UINT256 });
  const { before } = await show(info);
  const value = screen.getByText('1 AX721 #' + MAX_UINT256, { exact: true });

  expect(value.textContent).toBe('1 AX721 #' + MAX_UINT256);
  expect(value).toHaveClass(
    'min-w-0',
    'max-w-full',
    'break-all',
    'text-center',
    'text-white',
    'text-base'
  );
  for (const forbidden of ['w-full', 'truncate', 'line-clamp-1'])
    expect(value.classList.contains(forbidden)).toBe(false);
  expect(value).not.toHaveAttribute('title');
  expect(value).not.toHaveAttribute('tabindex');
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(JSON.stringify(info)).toBe(before);
});
