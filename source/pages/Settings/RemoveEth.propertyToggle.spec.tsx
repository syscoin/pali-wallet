/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { useWalletProviderDefault } from 'components/Modal/WalletProviderDafault/hooks/useWalletProviderDefault';

import RemoveEth from './RemoveEth';

const mockEmitter = jest.fn();
let mockHasEthProperty: boolean;

jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { hasEthProperty: mockHasEthProperty } }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { wallet?: string }) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      if (
        key === 'settings.disablePaliProvider' ||
        key === 'settings.enablePaliProvider'
      )
        return messages.settings[key.split('.')[1]];
      if (key === 'settings.setWalletAsDefault')
        return messages.settings.setWalletAsDefault.replace(
          '{{wallet}}',
          values?.wallet || ''
        );
      if (key.startsWith('providerDefault.'))
        return messages.providerDefault[key.split('.')[1]];
      return key;
    },
  }),
}));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
  DefaultModal: () => null,
  Icon: () => null,
  PageActionFooter: jest.requireActual(
    '../../components/PageActionFooter/PageActionFooter'
  ).PageActionFooter,
}));

it.each([true, false])(
  'keeps the default-wallet choice with Close in the responsive action footer (enabled=%s)',
  (enabled) => {
    mockHasEthProperty = enabled;
    render(<RemoveEth />);
    const action = screen.getByRole('button', {
      name: enabled
        ? 'Disable Pali’s Ethereum provider'
        : 'Enable Pali’s Ethereum provider',
    });
    expect(action.closest('[data-page-action-footer]')).not.toBeNull();
    expect(action).toHaveClass('w-full', 'min-w-0', 'min-h-[44px]');
    expect(action).not.toHaveClass('w-[352px]');
    expect(action).toHaveAttribute('type', 'button');
    expect(
      screen
        .getByRole('button', { name: 'buttons.close' })
        .closest('[data-page-action-footer]')
    ).toBe(action.closest('[data-page-action-footer]'));
    const warning = screen.queryByText('settings.disablePaliProviderWarning');
    if (enabled) {
      expect(warning).toBeVisible();
      expect(warning!.closest('[data-page-action-footer]')).toBe(
        action.closest('[data-page-action-footer]')
      );
    } else {
      expect(warning).toBeNull();
    }
  }
);

it('blocks overlapping settings choices while normal property delivery is pending', async () => {
  mockHasEthProperty = true;
  let complete: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  mockEmitter
    .mockReset()
    .mockImplementation((methods) =>
      methods[1] === 'removeWindowEthProperty' ? pending : Promise.resolve({})
    );
  render(<RemoveEth />);

  const disable = screen.getByRole('button', {
    name: 'Disable Pali’s Ethereum provider',
  });
  fireEvent.click(disable);
  expect(disable).toBeDisabled();
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith([
      'wallet',
      'removeWindowEthProperty',
    ])
  );
  fireEvent.click(disable);
  expect(mockEmitter).toHaveBeenCalledTimes(2);

  mockHasEthProperty = false;
  await act(async () => complete());
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Enable Pali’s Ethereum provider' })
    ).toBeEnabled()
  );
  expect(
    mockEmitter.mock.calls.some(
      ([methods]) => methods[1] === 'setHasEthProperty'
    )
  ).toBe(false);
  expect(mockEmitter).not.toHaveBeenCalledWith([
    'wallet',
    'addWindowEthProperty',
  ]);
});

it('uses the authoritative preference without optimistic success or late setter calls', async () => {
  mockHasEthProperty = false;
  let complete: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  mockEmitter
    .mockReset()
    .mockImplementation((methods) =>
      methods[1] === 'addWindowEthProperty' ? pending : Promise.resolve({})
    );
  const DefaultWallet = () => useWalletProviderDefault().modalText;
  const view = render(<DefaultWallet />);

  fireEvent.click(screen.getByText('Set Pali as default wallet!'));
  fireEvent.click(screen.getByText('Set Pali as default wallet!'));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'addWindowEthProperty']);

  expect(
    screen.queryByText('Pali was successfully set as the default wallet!')
  ).toBeNull();
  await act(async () => complete());
  mockHasEthProperty = true;
  view.rerender(<DefaultWallet />);
  expect(
    screen.getByText('Pali was successfully set as the default wallet!')
  ).toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  'settings rejection retains the authoritative preference=%s and releases the loading guard',
  async (enabled) => {
    mockHasEthProperty = enabled;
    mockEmitter.mockReset().mockRejectedValue(new Error('storage unavailable'));
    const error = jest.spyOn(console, 'error').mockImplementation();
    try {
      render(<RemoveEth />);
      const label = enabled
        ? 'Disable Pali’s Ethereum provider'
        : 'Enable Pali’s Ethereum provider';
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: label })).toBeEnabled()
      );
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenCalledWith(
        enabled ? ['dapp', 'getAll'] : ['wallet', 'addWindowEthProperty']
      );
      expect(
        mockEmitter.mock.calls.some(([methods]) =>
          ['disconnect', 'removeWindowEthProperty'].includes(methods[1])
        )
      ).toBe(false);
    } finally {
      error.mockRestore();
    }
  }
);

it('default-wallet rejection shows no false success and permits a later explicit choice', async () => {
  mockHasEthProperty = false;
  mockEmitter
    .mockReset()
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValue(undefined);
  const error = jest.spyOn(console, 'error').mockImplementation();
  const DefaultWallet = () => useWalletProviderDefault().modalText;
  try {
    render(<DefaultWallet />);
    fireEvent.click(screen.getByText('Set Pali as default wallet!'));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(
      screen.queryByText('Pali was successfully set as the default wallet!')
    ).toBeNull();
    fireEvent.click(screen.getByText('Set Pali as default wallet!'));
    expect(mockEmitter).toHaveBeenCalledTimes(2);
  } finally {
    error.mockRestore();
  }
});
