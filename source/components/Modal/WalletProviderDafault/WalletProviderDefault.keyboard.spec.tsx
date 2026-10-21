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
        'generalMenu.manageEth': 'Set default wallet',
        'buttons.close': 'Close',
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
const opener = () => screen.getByRole('button', { name: 'Set default wallet' });
const action = () =>
  screen.getByRole('button', { name: 'Set Pali as default wallet!' });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('retains ordinary hover and pointer activation', async () => {
  const view = mount();
  fireEvent.mouseEnter(view.container.querySelector('.fixed')!);
  expect(screen.getByText('Set Pali as default wallet!')).toBeInTheDocument();
  await act(async () =>
    fireEvent.click(screen.getByText('Set Pali as default wallet!'))
  );
  expect(mockEmitter.mock.calls).toEqual([
    [['wallet', 'addWindowEthProperty']],
  ]);
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
  expect(screen.queryByText('Set Pali as default wallet!')).toBeNull();
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
    screen.getByText('Pali was successfully set as the default wallet!')
  ).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(999));
  expect(opener()).not.toBeDisabled();
  act(() => jest.advanceTimersByTime(1));
  expect(
    screen.queryByRole('button', { name: 'Set default wallet' })
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
    within(container).queryByText('Set Pali as default wallet!')
  ).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});
