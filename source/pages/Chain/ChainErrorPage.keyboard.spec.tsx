/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { ChainErrorPage } from './ChainErrorPage';

const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockNetwork = {
  label: 'Synthetic',
  chainId: 57,
  kind: 'syscoin',
  default: true,
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: { activeNetwork: mockNetwork },
      vaultGlobal: { networkTarget: null },
    }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({
    navigate: mockNavigate,
    alert: { success: jest.fn(), error: jest.fn() },
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon', () => ({ Icon: () => null }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getState: jest.fn() },
}));
jest.mock('state/vaultGlobal', () => ({
  switchNetworkError: () => ({}),
  resetNetworkStatus: () => ({}),
}));
jest.mock('utils/navigationState', () => ({
  createNavigationContext: (path: string) => ({ path }),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
}));

it.each(['{Enter}', ' '])(
  'opens current RPC editing using %s on a named native button',
  async (key) => {
    mockNavigateWithContext.mockReset();
    const user = userEvent.setup();
    render(<ChainErrorPage />);
    const edit = screen.getByRole('button', {
      name: 'chainError.editCurrentRpc',
    });
    expect(edit).toHaveAttribute('type', 'button');
    await user.tab();
    expect(edit).toHaveFocus();
    await user.keyboard(key);
    expect(mockNavigateWithContext).toHaveBeenCalledTimes(1);
    expect(mockNavigateWithContext).toHaveBeenCalledWith(
      mockNavigate,
      '/settings/networks/custom-rpc',
      { selected: mockNetwork, chain: 57, isDefault: true, isEditing: true },
      { path: '/chain-fail-to-connect' }
    );
  }
);
