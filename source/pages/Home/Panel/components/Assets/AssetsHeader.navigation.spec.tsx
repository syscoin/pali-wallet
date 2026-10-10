/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
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
