/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  createBrowsingNavigationContext,
  navigateWithContext,
  navigateBack,
} from 'utils/navigationState';

import { NftsDetails } from './NftsDetails';

let mockState: any;
const mockEmitter = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    alert: mockAlert,
  }),
  useAdjustedExplorer: () => 'https://synthetic.example/',
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/TokenIcon', () => ({ TokenIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  FiExternalLink: () => null,
  RiFileCopyLine: () => null,
  LoadingOutlined: () => <span data-testid="verifying" />,
  Icon: ({ name }: { name: string }) => <span data-testid={name} />,
}));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const nft = {
  contractAddress: `0x${'ab'.repeat(20)}`,
  tokenStandard: 'ERC-721',
  name: 'Synthetic NFT',
  chainId: 57057,
  balance: 2,
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEmitter.mockReset();
  mockState = {
    vault: {
      activeNetwork: { chainId: 57057, explorer: 'https://synthetic.example/' },
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: `0x${'11'.repeat(20)}` } } },
    },
  };
  mockEmitter.mockImplementation(([, method]) => {
    if (method === 'fetchNftTokenIds')
      return Promise.resolve({
        tokens: [],
        hasMore: false,
        requiresManualEntry: true,
      });
    if (method === 'verifyERC721Ownership') return Promise.resolve([]);
    throw new Error(`Unexpected ${method}`);
  });
});
afterEach(() => jest.useRealTimers());

let ids = ['1', '2'];
let route: ReturnType<typeof useLocation>;
const Layout = () => {
  const location = useLocation();
  route = location;
  const navigate = useNavigate();
  return (
    <Routes>
      <Route
        path="/home/details"
        element={
          <>
            <NftsDetails nftData={{ ...nft, balance: ids.length }} />
            <button
              onClick={() =>
                navigateWithContext(
                  navigate,
                  '/settings/about',
                  {},
                  createBrowsingNavigationContext(location)
                )
              }
            >
              Leave
            </button>
          </>
        }
      />
      <Route
        path="/settings/about"
        element={
          <button onClick={() => navigateBack(navigate, location)}>Back</button>
        }
      />
    </Routes>
  );
};

it.each(['chip', 'manual', 'automatic'])(
  'restores %s selection intent through sanitized navigation while using only fresh ownership observations',
  async (intent) => {
    ids = ['1', '2'];
    mockEmitter.mockImplementation(([, method], args) => {
      if (method === 'fetchNftTokenIds')
        return Promise.resolve({
          tokens: ids.map((tokenId) => ({ tokenId, balance: 1 })),
          hasMore: false,
          requiresManualEntry: false,
        });
      if (method === 'verifyERC721Ownership')
        return Promise.resolve([
          { tokenId: args[2][0], verified: true, balance: 0 },
        ]);
      throw new Error(`Unexpected ${method}`);
    });
    render(
      <MemoryRouter initialEntries={['/home/details']}>
        <Layout />
      </MemoryRouter>
    );
    await act(async () => undefined);
    if (intent === 'chip')
      fireEvent.click(screen.getByRole('button', { name: '#2' }));
    if (intent === 'manual')
      fireEvent.change(screen.getByPlaceholderText('send.enterTokenId'), {
        target: { value: '2' },
      });
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(route.pathname).toBe('/settings/about');
    const saved = route.state.returnContext.state.nftView.value;
    expect(saved.explicitTokenId).toBe(intent === 'chip' ? '2' : undefined);
    expect(saved).not.toHaveProperty('verifiedTokenBalance');
    expect(saved).not.toHaveProperty('nftTokenIds');
    ids = intent === 'automatic' ? ['2'] : ['1'];
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await act(async () => undefined);
    const copy = screen.getByRole('button', {
      name: 'buttons.copy send.tokenId',
    });
    expect(copy.closest('li')?.querySelector('span')?.textContent).toBe('2');
    if (intent !== 'automatic')
      expect(screen.queryByRole('button', { name: '#2' })).toBeNull();
    expect(screen.queryByTestId('check')).toBeNull();
    if (intent === 'manual') {
      await act(async () => jest.advanceTimersByTimeAsync(500));
      expect(screen.getByText(/send.youDontOwnThisToken/)).toBeTruthy();
    }
    expect(
      mockEmitter.mock.calls.filter(
        ([[, method]]) => method === 'fetchNftTokenIds'
      )
    ).toHaveLength(2);
  }
);
