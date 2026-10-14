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
  useTranslation: () => ({ t: (value: string) => value }),
}));
jest.mock('components/index', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
  DefaultModal: () => null,
  Icon: () => null,
}));

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

  fireEvent.click(
    screen.getByRole('button', { name: 'Set Metamask as default wallet' })
  );
  const enable = screen.getByRole('button', {
    name: 'Set Pali as default wallet',
  });
  expect(enable).toBeDisabled();
  fireEvent.click(enable);
  expect(mockEmitter).toHaveBeenCalledTimes(1);

  await act(async () => complete());
  await waitFor(() => expect(enable).toBeEnabled());
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setHasEthProperty'],
    [false]
  );
  expect(mockEmitter).not.toHaveBeenCalledWith([
    'wallet',
    'addWindowEthProperty',
  ]);
});

it('waits for the normal default-wallet action before storing its preference', async () => {
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
  render(<DefaultWallet />);

  fireEvent.click(screen.getByText('Set Pali as default wallet!'));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'addWindowEthProperty']);

  await act(async () => complete());
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setHasEthProperty'],
    [true]
  );
});
