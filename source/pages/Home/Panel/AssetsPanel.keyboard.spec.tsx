/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { AssetsPanel } from './AssetsPanel';

const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
let mockBitcoinBased = false;
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      assets: { ethereum: [], syscoin: [] },
      vault: {
        isBitcoinBased: mockBitcoinBased,
        activeNetwork: { chainId: 5700 },
      },
    }),
}));
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams('tab=assets')],
  useLocation: () => ({ pathname: '/home', search: '?tab=assets' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountAndVaultData: (state: any) => ({
    assets: state.assets,
    activeNetwork: state.vault.activeNetwork,
    isBitcoinBased: state.vault.isBitcoinBased,
  }),
  selectActiveAccountRef: () => undefined,
}));
jest.mock('components/Icon/Icon', () => ({
  CgImport: () => <svg aria-hidden="true" />,
}));
jest.mock('./components/Assets', () => ({
  EvmAssetsList: () => null,
  SyscoinAssetsList: () => null,
}));
jest.mock('utils/index', () => ({
  createBrowsingNavigationContext: (location: any, state: any) => ({
    location,
    state,
  }),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
}));

beforeEach(() => mockNavigateWithContext.mockReset());

it.each([false, true])(
  'opens token import through the keyboard from an empty asset list (UTXO=%s)',
  async (bitcoinBased) => {
    mockBitcoinBased = bitcoinBased;
    const user = userEvent.setup();
    render(<AssetsPanel />);
    const button = screen.getByRole('button', { name: 'home.importToken' });
    expect(button).toHaveAttribute('type', 'button');
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mockNavigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/tokens/add',
      {},
      {
        location: { pathname: '/home', search: '?tab=assets' },
        state: { tab: 'assets' },
      }
    );
  }
);
