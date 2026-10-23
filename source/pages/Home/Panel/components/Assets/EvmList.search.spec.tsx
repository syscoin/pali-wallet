/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { EvmAssetsList } from './EvmList';

let mockAssets: any[];
let mockView: any;
const initialView = {
  isCoinSelected: true,
  searchValue: '',
  sortByValue: '',
  tokensVisibleCount: 50,
  nftsVisibleCount: 50,
};
const token = (isNft: boolean) => ({
  id: isNft ? 'nft' : 'token',
  chainId: 5700,
  contractAddress: '0x' + (isNft ? '22' : '11').repeat(20),
  tokenSymbol: isNft ? 'QANFT' : 'QAASSET',
  name: isNft ? 'QA Collection' : 'QA Asset',
  balance: 2,
  decimals: isNft ? 0 : 18,
  tokenStandard: isNft ? 'ERC-721' : 'ERC-20',
  isNft,
});
jest.mock('../../../useHomeBrowsingState', () => ({
  DEFAULT_ASSETS_VIEW: {},
  getHomeBrowsingScope: () => 'test-scope',
  useHomeBrowsingState: () => jest.requireActual('react').useState(mockView),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      account: { id: 0, type: 'HDAccount', address: 'public-address' },
      assets: { ethereum: mockAssets },
      vault: { activeNetwork: { chainId: 5700 } },
      vaultGlobal: { networkStatus: 'idle' },
    }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) => state.account,
  selectActiveAccountRef: (state: any) => state.account,
  selectActiveAccountAssets: (state: any) => state.assets,
  selectActiveAccountWithAssets: (state: any) => ({
    account: state.account,
    assets: state.assets,
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (copyKey: string, copyValues?: any) =>
      jest
        .requireActual('../../../../../../tests/helpers/localizedUiCopy')
        .localizedUiCopy(copyKey, copyValues) ??
      (((key: string) => key) as any)(copyKey, copyValues),
  }),
}));
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('tab=assets')],
  useLocation: () => ({ state: null }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({ navigate: jest.fn() }) }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('components/index', () => ({
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  TokenIcon: () => null,
}));
jest.mock('components/Modal', () => ({ ConfirmationModal: () => null }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  BsCheck2: () => null,
  CgSearch: () => null,
  FaRegStickyNote: () => null,
  HiTrash: () => null,
  MdClose: () => null,
  RiArrowLeftSLine: () => null,
  RiCoinLine: () => null,
  RiOrderPlayLine: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('utils/index', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  truncate: (text: string) => text,
  ellipsis: (text: string) => text,
  formatFullPrecisionBalance: (value: number) => String(value),
}));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));

beforeEach(() => {
  mockAssets = [token(false), token(true)];
  mockView = { ...initialView };
});

it.each([false, true])(
  'distinguishes a filtered-zero %s NFT list and clears back to focused search',
  async (isNft) => {
    mockView.isCoinSelected = !isNft;
    const symbol = isNft ? 'QANFT' : 'QAASSET';
    const details = `View details for ${symbol} ${
      isNft ? 'collection' : 'token'
    }`;
    const user = userEvent.setup();
    render(<EvmAssetsList scope="synthetic-test-scope" />);
    await user.click(
      screen.getByRole('button', { name: 'tooltip.searchAssets' })
    );
    const input = screen.getByRole('textbox');
    await user.type(input, ` ${symbol} `);
    expect(input).toHaveValue(` ${symbol} `);
    expect(screen.getByRole('button', { name: details })).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'not-a-matching-asset');
    expect(screen.getByRole('status')).toHaveTextContent(
      'assetsHeader.noMatchingAssets'
    );
    expect(screen.queryByText('home.youHaveNoNfts')).not.toBeInTheDocument();
    expect(screen.queryByText('home.youHaveNoTokens')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'assetsHeader.clearSearch' })
    );
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: details })).toBeInTheDocument();
  }
);

it.each([false, true])(
  'keeps genuinely empty %s NFT inventory distinct from zero search matches',
  (isNft) => {
    mockView = {
      ...initialView,
      isCoinSelected: !isNft,
      searchValue: 'missing',
    };
    mockAssets = [token(!isNft)];
    render(<EvmAssetsList scope="synthetic-test-scope" />);
    expect(
      screen.getByText(isNft ? 'home.youHaveNoNfts' : 'home.youHaveNoTokens')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('assetsHeader.noMatchingAssets')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'assetsHeader.clearSearch' })
    ).not.toBeInTheDocument();
  }
);
