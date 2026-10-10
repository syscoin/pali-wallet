/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { NetworkMenu } from './NetworkMenu';

const mockNavigate = jest.fn();
let mockLocation: any;
const mockState = {
  vault: {
    activeAccount: { id: 0, type: 'HDAccount' },
    accounts: { HDAccount: { 0: { address: '0xabc', xpub: 'public' } } },
    activeNetwork: {
      chainId: 1,
      kind: 'ethereum',
      url: 'https://rpc.test',
      label: 'Ethereum',
    },
    isBitcoinBased: false,
  },
  vaultGlobal: {
    networkStatus: 'idle',
    networks: { syscoin: {}, ethereum: {} },
  },
  dapp: { dapps: {} },
};
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState, dispatch: jest.fn() },
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  EditIconSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => null,
}));

it.each([
  ['networkMenu.noConnected', '/settings/networks/connected-sites'],
  ['networkMenu.trustedSites', '/settings/networks/trusted-sites'],
  ['networkMenu.customRpc', '/settings/networks/custom-rpc'],
  ['networkMenu.manageNetworks', '/settings/networks/edit'],
])(
  'captures the latest browsing context through %s even with a stable navigator',
  (label, target) => {
    mockNavigate.mockClear();
    mockLocation = {
      pathname: '/home',
      search: '?tab=activity',
      hash: '',
      state: {
        homeActivity: {
          scope: 'scope',
          value: { nextPage: 2, visibleCount: 50 },
        },
      },
    };
    const view = render(<NetworkMenu />);
    const scroller = document.createElement('div');
    scroller.dataset.navigationScroll = 'wallet-layout';
    scroller.scrollTop = 420;
    document.body.append(scroller);
    const homeAssets = {
      scope: 'scope',
      value: {
        isCoinSelected: true,
        searchValue: 'NAV',
        sortByValue: 'name',
        tokensVisibleCount: 150,
        nftsVisibleCount: 50,
      },
    };
    mockLocation = {
      ...mockLocation,
      search: '?tab=assets',
      state: {
        homeAssets,
        returnContext: { returnRoute: '/home/smart-account' },
      },
    };
    view.rerender(<NetworkMenu />);
    try {
      fireEvent.click(screen.getByText(label));
      expect(mockNavigate).toHaveBeenCalledWith(
        target,
        expect.objectContaining({
          state: expect.objectContaining({
            returnContext: expect.objectContaining({
              returnRoute: '/home?tab=assets',
              state: { homeAssets },
              scrollPositions: { 'wallet-layout': 420 },
              returnContext: { returnRoute: '/home/smart-account' },
            }),
          }),
        })
      );
    } finally {
      scroller.remove();
    }
  }
);
