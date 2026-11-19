/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import ForgetWallet from './ForgetWallet';

const seed = 'synthetic alpha beta gamma delta epsilon';
const mockTranslate = (key: string) => key;
const mockEmitter = jest.fn();
const mockClipboard = jest.fn();
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings/forget-wallet' }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { balances: { ethereum: 1 } } } },
      },
    }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { subscribe: () => () => undefined },
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
  subscribeControllerStatus: () => () => undefined,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({
  navigateBack: jest.fn(),
  getWalletNavigationScope: () => ({
    account: 'test-account',
    network: 'test-network',
  }),
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg />,
  FiCopy: () => <svg aria-hidden="true" />,
  QrcodeOutlined: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  Button: jest.requireActual('components/Button/Button').Button,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  ValidatedPasswordInput: jest.requireActual(
    'components/Input/ValidatedPasswordInput'
  ).ValidatedPasswordInput,
  SeedPhraseDisplay: jest.requireActual('components/Input/SeedPhraseDisplay')
    .SeedPhraseDisplay,
}));

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
  mockEmitter.mockReset().mockResolvedValue(seed);
  mockClipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockClipboard },
  });
});

const enterPassword = (password = 'synthetic password') => {
  fireEvent.change(document.getElementById('forget_password')!, {
    target: { value: password },
  });
};
const confirmPassword = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));

it('copies only the explicitly revealed phrase and clears its presentation on blur', async () => {
  render(<ForgetWallet />);
  enterPassword();
  confirmPassword();
  const show = await screen.findByRole('button', {
    name: 'import.showSeedPhrase',
  });
  expect(
    screen.queryByRole('button', { name: 'secretClipboard.copyPhrase' })
  ).toBeNull();
  fireEvent.click(show);
  fireEvent.click(
    screen.getByRole('button', { name: 'secretClipboard.copyPhrase' })
  );
  await screen.findByText('components.copied');
  expect(mockClipboard).toHaveBeenCalledWith(seed);
  act(() => window.dispatchEvent(new Event('blur')));
  expect(
    screen.queryByRole('button', { name: 'secretClipboard.copyPhrase' })
  ).toBeNull();
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  expect(document.getElementById('forget_password')).toHaveValue('');
});

it('keeps a delayed authenticated seed masked until Show and masks it again on Hide', async () => {
  let resolve!: (value: string) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done;
    })
  );
  render(<ForgetWallet />);
  enterPassword();
  confirmPassword();
  expect(
    screen.queryByRole('button', { name: 'import.showSeedPhrase' })
  ).toBeNull();
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  await act(async () => resolve(seed));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getSeed'],
    ['synthetic password']
  );
  const show = await screen.findByRole('button', {
    name: 'import.showSeedPhrase',
  });
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  fireEvent.click(show);
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  fireEvent.click(
    screen.getByRole('button', { name: 'import.hideSeedPhrase' })
  );
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  expect(
    screen.getByRole('button', { name: 'import.showSeedPhrase' })
  ).toBeVisible();
});

it('clears a revealed seed on password edit and requires a fresh Show after reauthentication', async () => {
  render(<ForgetWallet />);
  enterPassword();
  confirmPassword();
  fireEvent.click(
    await screen.findByRole('button', { name: 'import.showSeedPhrase' })
  );
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  enterPassword('');
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  expect(
    screen.queryByRole('button', { name: 'import.showSeedPhrase' })
  ).toBeNull();
  enterPassword();
  confirmPassword();
  const show = await screen.findByRole('button', {
    name: 'import.showSeedPhrase',
  });
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  fireEvent.click(show);
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it('retires an authenticated completion that resolves after blur', async () => {
  let finish!: (value: string) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise<string>((done) => {
      finish = done;
    })
  );
  render(<ForgetWallet />);
  enterPassword();
  confirmPassword();
  act(() => window.dispatchEvent(new Event('blur')));
  await act(async () => finish(seed));
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  expect(document.getElementById('forget_password')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'buttons.forget' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'import.showSeedPhrase' })
  ).toBeNull();
});

it('retains the independently password-authorized wallet removal action', async () => {
  render(<ForgetWallet />);
  enterPassword();
  confirmPassword();
  await screen.findByRole('button', { name: 'import.showSeedPhrase' });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.forget' }));
  await act(async () => undefined);
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'forgetWallet'],
    ['synthetic password']
  );
});

it('retires the revealed phrase and password when the document is hidden', async () => {
  render(<ForgetWallet />);
  enterPassword();
  confirmPassword();
  fireEvent.click(
    await screen.findByRole('button', { name: 'import.showSeedPhrase' })
  );
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  try {
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.getByRole('textbox')).not.toHaveValue(seed);
    expect(document.getElementById('forget_password')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'buttons.forget' })
    ).toBeDisabled();
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(
      screen.queryByRole('button', { name: 'import.showSeedPhrase' })
    ).toBeNull();
  } finally {
    visibility.mockRestore();
  }
});
