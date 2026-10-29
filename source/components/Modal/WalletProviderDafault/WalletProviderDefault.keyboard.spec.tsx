/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';

import { WalletProviderDefaultModal } from '.';

const mockEmitter = jest.fn();
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'generalMenu.manageEth': jest.requireActual(
          '../../../assets/locales/en.json'
        ).generalMenu.manageEth,
        'buttons.close': 'Close',
        'settings.paliProviderEnabled': jest.requireActual(
          '../../../assets/locales/en.json'
        ).settings.paliProviderEnabled,
        'settings.paliProviderDisabled': jest.requireActual(
          '../../../assets/locales/en.json'
        ).settings.paliProviderDisabled,
        'settings.enablePaliProvider': jest.requireActual(
          '../../../assets/locales/en.json'
        ).settings.enablePaliProvider,
      }[key] || key),
  }),
}));
jest.mock('components/index', () => ({
  Icon: () => <svg aria-hidden="true" />,
}));

const mount = (enabled = false) => {
  const store = configureStore({
    reducer: {
      vaultGlobal: (state = { hasEthProperty: enabled }, action) =>
        action.type === 'test/provider'
          ? { hasEthProperty: action.payload }
          : state,
    },
  });
  const view = render(
    <Provider store={store}>
      <WalletProviderDefaultModal />
      <button type="button">After widget</button>
    </Provider>
  );
  return { ...view, store };
};
const opener = () =>
  screen.getByRole('button', { name: 'Manage Ethereum provider' });
const action = () =>
  screen.getByRole('button', { name: 'Enable Pali’s Ethereum provider' });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('reports Pali provider state without assuming a different default wallet', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { store } = mount(true);
  act(() => store.dispatch({ type: 'test/provider', payload: false }));
  await user.tab();
  await user.keyboard('{Enter}');
  expect(
    screen.getByText('Pali’s Ethereum provider is disabled')
  ).toBeVisible();
  expect(screen.queryByText(/MetaMask/i)).toBeNull();
  expect(action()).toBeEnabled();
  expect(mockEmitter).not.toHaveBeenCalled();
  await user.tab();
  await user.keyboard('{Enter}');
  expect(mockEmitter).toHaveBeenCalledWith(['wallet', 'addWindowEthProperty']);
  act(() => store.dispatch({ type: 'test/provider', payload: true }));
  expect(screen.getByText('Pali’s Ethereum provider is enabled')).toBeVisible();
  expect(
    screen.queryByText(/successfully set as the default wallet/i)
  ).toBeNull();
});

it('retains ordinary hover and pointer activation', async () => {
  mount();
  fireEvent.mouseEnter(opener());
  expect(
    screen.getByText('Enable Pali’s Ethereum provider')
  ).toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByText('Enable Pali’s Ethereum provider'))
  );
  expect(mockEmitter.mock.calls).toEqual([
    [['wallet', 'addWindowEthProperty']],
  ]);
});

it('stays closed when removing the Close target causes parent-only pointer re-entry', () => {
  const view = mount();
  const container = view.container.querySelector('.fixed')!;
  fireEvent.mouseEnter(opener());
  expect(action()).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(opener()).toHaveFocus();
  expect(screen.queryByText('Enable Pali’s Ethereum provider')).toBeNull();

  // The pointer can remain over the collapsing parent after its Close target
  // is removed. Only entering the opener should deliberately reopen it.
  fireEvent.mouseEnter(container);
  expect(opener()).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Enable Pali’s Ethereum provider')).toBeNull();
  fireEvent.mouseEnter(opener());
  expect(opener()).toHaveAttribute('aria-expanded', 'true');
  expect(action()).toBeInTheDocument();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each(['{Enter}', ' '])(
  'opens through Tab and %s, then reaches the native provider action',
  async (key) => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mount();
    await user.tab();
    expect(opener()).toHaveFocus();
    expect(opener()).toHaveAttribute('type', 'button');
    expect(opener()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(key);
    expect(opener()).toHaveAttribute('aria-expanded', 'true');
    expect(opener()).toHaveAttribute('aria-controls', 'default-wallet-options');
    await user.tab();
    expect(action()).toHaveFocus();
    expect(action()).toHaveAttribute('type', 'button');
    await user.keyboard(key);
    expect(mockEmitter.mock.calls).toEqual([
      [['wallet', 'addWindowEthProperty']],
    ]);
  }
);

it('closes with its native control and returns focus without changing the provider', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  mount();
  await user.tab();
  await user.keyboard('{Enter}');
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  await user.keyboard(' ');
  expect(opener()).toHaveFocus();
  expect(opener()).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Enable Pali’s Ethereum provider')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('closes with Escape without activating the focused provider action', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  mount();
  await user.tab();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(action()).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(opener()).toHaveFocus();
  expect(opener()).toHaveAttribute('aria-expanded', 'false');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps keyboard focus usable after pointer leave and closes when focus leaves', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const view = mount();
  await user.tab();
  await user.keyboard('{Enter}');
  await user.tab();
  fireEvent.mouseLeave(view.container.querySelector('.fixed')!);
  expect(action()).toHaveFocus();
  expect(opener()).toHaveAttribute('aria-expanded', 'true');
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After widget' })).toHaveFocus();
  expect(opener()).toHaveAttribute('aria-expanded', 'false');
});

it('retains the pending guard and allows a failed provider choice to be retried', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  let reject!: (error: Error) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise((_, fail) => (reject = fail))
  );
  const error = jest.spyOn(console, 'error').mockImplementation();
  try {
    mount();
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard('{Enter}{Enter}');
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Synthetic storage refusal')));
    expect(action()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(mockEmitter).toHaveBeenCalledTimes(2);
  } finally {
    error.mockRestore();
  }
});

it('retains the one-second success display and removes hidden controls from the tab order', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { store } = mount();
  await user.tab();
  await user.keyboard('{Enter}');
  act(() => store.dispatch({ type: 'test/provider', payload: true }));
  expect(
    screen.getByText('Pali’s Ethereum provider is enabled')
  ).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(999));
  expect(opener()).not.toBeDisabled();
  act(() => jest.advanceTimersByTime(1));
  expect(
    screen.queryByRole('button', { name: 'Manage Ethereum provider' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  await user.tab();
  expect(screen.getByRole('button', { name: 'After widget' })).toHaveFocus();
});

it('does not expose invisible controls for an initially enabled provider', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { container } = mount(true);
  await user.tab();
  expect(screen.getByRole('button', { name: 'After widget' })).toHaveFocus();
  expect(
    within(container).queryByText('Enable Pali’s Ethereum provider')
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('reveals the mounted widget when Pali is no longer the default provider', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { store } = mount(true);
  expect(
    screen.queryByRole('button', { name: 'Manage Ethereum provider' })
  ).toBeNull();
  act(() => store.dispatch({ type: 'test/provider', payload: false }));
  expect(opener()).toBeEnabled();
  await user.tab();
  expect(opener()).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(action()).toHaveFocus();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('cancels a pending success-hide timer when the provider is disabled again', async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { store } = mount();
  await user.tab();
  await user.keyboard('{Enter}');
  act(() => store.dispatch({ type: 'test/provider', payload: true }));
  act(() => jest.advanceTimersByTime(500));
  act(() => store.dispatch({ type: 'test/provider', payload: false }));
  act(() => jest.advanceTimersByTime(1000));
  expect(opener()).toBeEnabled();
  expect(opener()).toHaveAttribute('aria-expanded', 'true');
  expect(action()).toBeEnabled();
  expect(screen.queryByText('Pali’s Ethereum provider is enabled')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});
