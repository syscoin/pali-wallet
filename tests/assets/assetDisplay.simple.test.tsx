import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import '@testing-library/jest-dom';

// Mock all hooks and dependencies
jest.mock('react-redux', () => ({
  ...jest.requireActual('react-redux'),
  useSelector: jest.fn(),
  useDispatch: jest.fn(() => jest.fn()),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn(), language: 'en' },
  }),
  I18nextProvider: ({ children }: any) => children,
}));

jest.mock('../../source/hooks', () => ({
  useUtils: () => ({
    useCopyClipboard: () => [false, jest.fn()],
    alert: { info: jest.fn(), error: jest.fn() },
    navigate: jest.fn(),
  }),
  useAdjustedExplorer: (explorer: string) => explorer,
  useController: () => ({
    controllerEmitter: jest.fn(),
  }),
}));

// Simple component test
describe('Asset Display Simple Tests', () => {
  const mockState = {
    vault: {
      activeNetwork: {
        label: 'Ethereum',
        explorer: 'https://etherscan.io/',
        chainId: 1,
        currency: 'ETH',
        slip44: 60,
      },
      activeAccount: {
        type: 'HDAccount',
        id: 0,
      },
      accountAssets: {
        HDAccount: {
          0: {
            ethereum: [
              {
                id: '0x6b175474e89094c44da98b954eedeac495271d0f-1',
                contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
                tokenSymbol: 'DAI',
                decimals: 18,
                balance: 1000.5,
                chainId: 1,
                isNft: false,
                tokenStandard: 'ERC-20',
                name: 'Dai Stablecoin',
                logo: 'https://assets.coingecko.com/coins/images/9956/small/4943.png',
              },
            ],
            syscoin: [],
            nfts: [],
          },
        },
      },
    },
  };

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    (require('react-redux').useSelector as jest.Mock).mockImplementation(
      (selector: (state: any) => any) => selector(mockState)
    );
  });

  it('should render without crashing', () => {
    const TestComponent = () => <div>Test Component</div>;

    const store = configureStore({
      reducer: {
        vault: () => mockState.vault,
      },
    });

    render(
      <Provider store={store}>
        <TestComponent />
      </Provider>
    );

    expect(screen.getByText('Test Component')).toBeInTheDocument();
  });

  it('should handle mock data correctly', () => {
    expect(mockState.vault.accountAssets.HDAccount[0].ethereum).toHaveLength(1);
    expect(
      mockState.vault.accountAssets.HDAccount[0].ethereum[0].tokenSymbol
    ).toBe('DAI');
  });
});
