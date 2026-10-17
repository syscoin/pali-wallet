/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { AssetsHeader } from './AssetsHeader';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  BsCheck2: () => null,
  CgSearch: () => null,
  FaRegStickyNote: () => null,
  MdClose: () => null,
  RiArrowLeftSLine: () => <span>Close search</span>,
  RiOrderPlayLine: () => null,
  RiCoinLine: () => null,
}));

it('shows a restored query and clears it only when the user closes search', () => {
  const setSearchValue = jest.fn();
  render(
    <AssetsHeader
      isCoinSelected={false}
      searchValue="NFT collection"
      sortByValue="Name"
      setIsCoinSelected={jest.fn()}
      setSearchValue={setSearchValue}
      setSortyByValue={jest.fn()}
    />
  );
  expect(setSearchValue).not.toHaveBeenCalled();
  expect(
    (
      screen.getByPlaceholderText(
        'assetsHeader.tokenOrContractAddress'
      ) as HTMLInputElement
    ).value
  ).toBe('NFT collection');
  fireEvent.change(
    screen.getByPlaceholderText('assetsHeader.tokenOrContractAddress'),
    { target: { value: 'different collection' } }
  );
  expect(setSearchValue).toHaveBeenCalledWith('different collection');
  fireEvent.click(screen.getByText('Close search'));
  expect(setSearchValue).toHaveBeenLastCalledWith('');
});

const InteractiveHeader = () => {
  const [isCoinSelected, setIsCoinSelected] = React.useState(true);
  const [searchValue, setSearchValue] = React.useState('');
  const [sortByValue, setSortyByValue] = React.useState('');
  return (
    <AssetsHeader
      {...{
        isCoinSelected,
        setIsCoinSelected,
        searchValue,
        setSearchValue,
        sortByValue,
        setSortyByValue,
      }}
    />
  );
};

it('operates sort, search and the token/NFT selectors entirely with the keyboard', async () => {
  const user = userEvent.setup();
  render(<InteractiveHeader />);
  const sort = screen.getByRole('button', { name: 'tooltip.sortAssets' });
  const search = screen.getByRole('button', { name: 'tooltip.searchAssets' });
  await user.tab();
  expect(sort).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(sort).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'send.balance' })).toHaveFocus();
  await user.tab();
  expect(
    screen.getByRole('button', { name: 'assetsHeader.name' })
  ).toHaveFocus();
  await user.keyboard(' ');
  expect(sort).toHaveFocus();
  expect(sort).toHaveAttribute('aria-expanded', 'false');

  await user.tab();
  expect(search).toHaveFocus();
  await user.keyboard(' ');
  const input = screen.getByRole('textbox', {
    name: 'assetsHeader.tokenOrContractAddress',
  });
  expect(input).toHaveFocus();
  await user.type(input, 'ETH');
  await user.keyboard('{Escape}');
  expect(input).not.toBeInTheDocument();
  const reopenedSearch = screen.getByRole('button', {
    name: 'tooltip.searchAssets',
  });
  expect(reopenedSearch).toHaveFocus();

  await user.tab();
  const tokens = screen.getByRole('button', { name: 'tooltip.viewTokens' });
  expect(tokens).toHaveFocus();
  expect(tokens).toHaveAttribute('aria-pressed', 'true');
  await user.tab();
  const nfts = screen.getByRole('button', { name: 'tooltip.viewNFTs' });
  expect(nfts).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(nfts).toHaveAttribute('aria-pressed', 'true');
  expect(tokens).toHaveAttribute('aria-pressed', 'false');
  await user.tab({ shift: true });
  await user.keyboard(' ');
  expect(tokens).toHaveAttribute('aria-pressed', 'true');
});

it('returns focus after Escape, Clear sort and the named search Back button', async () => {
  const user = userEvent.setup();
  render(<InteractiveHeader />);
  const sort = screen.getByRole('button', { name: 'tooltip.sortAssets' });
  await user.click(sort);
  await user.keyboard('{Escape}');
  expect(sort).toHaveFocus();
  expect(sort).toHaveAttribute('aria-expanded', 'false');
  await user.keyboard('{Enter}');
  await user.keyboard('{Enter}');
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'send.balance' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await user.click(
    screen.getByRole('button', { name: 'assetsHeader.clearSort' })
  );
  expect(sort).toHaveFocus();
  expect(sort).toHaveAttribute('aria-expanded', 'false');
  await user.click(
    screen.getByRole('button', { name: 'tooltip.searchAssets' })
  );
  const input = screen.getByRole('textbox');
  await user.type(input, 'asset');
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'buttons.back' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(
    screen.getByRole('button', { name: 'tooltip.searchAssets' })
  ).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('textbox')).toHaveValue('');
});
