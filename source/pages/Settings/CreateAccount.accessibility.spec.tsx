/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { INetworkType } from 'types/network';

import CreateAccount from './CreateAccount';

const mockT = (key: string) => key;
const mockEmitter = jest.fn();
let mockLocation: any;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vault: { activeNetwork: { kind: INetworkType.Ethereum } } }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => mockLocation,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: jest.fn(),
  }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: ({ children }: any) => <footer>{children}</footer>,
  Button: ({ children, type, disabled, loading }: any) => (
    <button type={type} disabled={disabled || loading}>
      {children}
    </button>
  ),
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  CreatedAccountSuccessfully: () => null,
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  mockEmitter.mockReset().mockResolvedValue({ address: 'synthetic-address' });
  mockLocation = { state: {} };
});

it.each([false, true])(
  'names the optional account field through editing in smart-only mode=%s',
  async (smartAccountOnly) => {
    mockLocation = { state: { smartAccountOnly } };
    render(<CreateAccount />);
    const name = 'settings.label (settings.optional)';
    const input = screen.getByRole('textbox', { name });
    expect(input).toHaveAttribute('placeholder', name);
    fireEvent.change(input, { target: { value: 'Travel account' } });
    expect(input).toHaveAccessibleName(name);
    fireEvent.click(
      screen.getByRole('button', {
        name: smartAccountOnly
          ? 'settings.createSmartAccount'
          : 'buttons.create',
      })
    );
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
    expect(mockEmitter.mock.calls[0]).toEqual(
      smartAccountOnly
        ? [
            ['wallet', 'createSmartAccount'],
            [{ label: 'Travel account' }],
            300000,
          ]
        : [['wallet', 'createAccount'], ['Travel account']]
    );
  }
);

it('keeps the name optional when creating a normal account', async () => {
  render(<CreateAccount />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.create' }));
  await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'createAccount'],
    [undefined]
  );
});
