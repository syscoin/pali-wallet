import React from 'react';

import { getAccountReviewTokens, TokenIcon, TokenIconStack } from './TokenIcon';

jest.mock('components/Icon/Icon', () => ({ NftFallbackSvg: () => null }));
jest.mock('components/Tooltip/Tooltip', () => ({ Tooltip: 'tooltip' }));

const tokens = [
  {
    id: 'a',
    logo: 'logo-a',
    symbol: 'ABC',
    name: 'Alpha',
    contractAddress: '0x1',
  },
  {
    id: 'b',
    logo: 'logo-a',
    symbol: 'BBB',
    name: 'Duplicate logo',
    assetGuid: '2',
  },
  { id: 'c', symbol: 'alpha', name: 'First initial', assetGuid: '3' },
  { id: 'd', symbol: 'A', name: 'Duplicate initial', assetGuid: '4' },
  { id: 'e', symbol: 'Z', name: 'Zed', assetGuid: '5' },
  { id: 'f', contractAddress: '0x6' },
  { id: 'g', assetGuid: '7' },
  { id: 'h', logo: 'logo-h', symbol: 'H', name: 'Last logo' },
  { id: 'i', assetGuid: '7' },
];

it('selects the same positive contract-token list for each account and network family without mutation', () => {
  const visible = Object.freeze({ contractAddress: '7', balance: '1' });
  const evm = Object.freeze({ contractAddress: '0xabc', balance: 2 });
  const utxo = Object.freeze([
    visible,
    { contractAddress: '8', balance: 0 },
    { contractAddress: '', balance: 3 },
    { contractAddress: '9', balance: -1 },
  ]);
  const assets = { Imported: { 0: { syscoin: utxo, ethereum: [evm] } } } as any;
  expect(getAccountReviewTokens(assets, true, { id: 0 }, 'Imported')).toEqual([
    visible,
  ]);
  expect(getAccountReviewTokens(assets, false, { id: 0 }, 'Imported')).toEqual([
    evm,
  ]);
  expect(getAccountReviewTokens(assets, true, null, 'Imported')).toEqual([]);
  expect(getAccountReviewTokens(assets, true, { id: 1 }, 'Imported')).toEqual(
    []
  );
  expect(getAccountReviewTokens(assets, true, { id: 0 }, 'HDAccount')).toEqual(
    []
  );
  expect(utxo).toHaveLength(4);
});
// Expected visible identity order from the three existing approval renderers.
// Logo-backed entries lead, while each category retains its original order.
const orders = [
  [],
  ['a'],
  ['a'],
  ['a', 'c'],
  ['a', 'c'],
  ['a', 'c', 'e'],
  ['a', 'c', 'e', 'f'],
  ['a', 'c', 'e', 'f', 'g'],
  ['a', 'h', 'c', 'e', 'f', 'g'],
  ['a', 'h', 'c', 'e', 'f', 'g'],
];
const cases = orders.flatMap((order, length) =>
  [undefined, 0, 1, 2, 3, 8].map((maxVisible) => ({
    length,
    maxVisible,
    expected: order.slice(0, maxVisible ?? 3),
    remaining: Math.max(0, order.length - (maxVisible ?? 3)),
  }))
);

const renderStack = (props: any): React.ReactElement | null =>
  (TokenIconStack as any).type(props);

it.each(cases)(
  'preserves approval icon layout for $length tokens with limit $maxVisible',
  ({ length, maxVisible, expected, remaining }) => {
    const input = tokens.slice(0, length).map((token) => Object.freeze(token));
    Object.freeze(input);
    const tree = renderStack({ tokens: input, maxVisible });
    if (length === 0) {
      expect(tree).toBeNull();
      return;
    }
    expect(tree!.props.className).toBe('flex items-center');
    const [icons, overflow] = tree!.props.children;
    expect(icons.props.className).toBe('flex');
    const visible = icons.props.children as React.ReactElement[];
    expect(visible.map((entry) => entry.key)).toEqual(expected);
    visible.forEach((entry, index) => {
      const token = tokens.find(
        (candidate) => candidate.id === expected[index]
      )!;
      expect(entry.props.content).toBe(token.name || token.symbol);
      const wrapper = entry.props.children;
      expect(wrapper.props.style).toEqual({
        marginLeft: index > 0 ? '-8px' : '0',
        zIndex: visible.length - index,
      });
      const icon = wrapper.props.children;
      expect(icon.type).toBe(TokenIcon);
      expect(icon.props).toEqual({
        logo: token.logo,
        contractAddress: token.contractAddress,
        assetGuid: token.assetGuid,
        symbol: token.symbol,
        size: 16,
        className: 'border border-bkg-3 rounded-full',
      });
    });
    if (remaining) {
      expect(overflow.props.children).toEqual(['+', remaining]);
      expect(overflow.props.className).toBe(
        'ml-1 text-[10px] text-brand-royalblue'
      );
    } else expect(overflow).toBe(false);
  }
);

it.each([undefined, null])('preserves empty output for %p tokens', (value) => {
  expect(renderStack({ tokens: value })).toBeNull();
});

it('retains the React.memo boundary and fallback keys', () => {
  expect((TokenIconStack as any).$$typeof).toBe(Symbol.for('react.memo'));
  const tree = renderStack({
    tokens: [
      { contractAddress: '0x1' },
      { assetGuid: '2' },
      { symbol: 'Third' },
    ],
  })!;
  const icons = tree.props.children[0].props.children;
  expect(icons.map((entry: React.ReactElement) => entry.key)).toEqual([
    '0x1',
    '2',
    '2',
  ]);
});
