/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { StartFreshWallet } from './StartFreshWallet';

const mockEmitter = jest.fn();
const mockClear = jest.fn();
const mockReload = jest.fn();
const mockOpenChange = jest.fn();
const TICKET = 'synthetic-reset-admission';
const originalResizeObserver = globalThis.ResizeObserver;
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useOnboardingSecrets', () => ({
  useOnboardingSecrets: () => ({ clear: mockClear }),
}));
jest.mock('utils/reloadWalletForRecovery', () => ({
  reloadWalletForRecovery: () => mockReload(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { word?: string }) =>
      key === 'start.eraseTypeConfirmation'
        ? `Type ${values?.word} to confirm.`
        : key,
  }),
}));
jest.mock('hooks/useToastFooter', () => ({
  useToastFooter: () => jest.requireActual('react').useRef(null),
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const resetCalls = () =>
  mockEmitter.mock.calls.filter(
    ([methods]) => methods[1] === 'resetLockedWallet'
  );
const mount = (disabled = false) =>
  render(
    <StartFreshWallet disabled={disabled} onOpenChange={mockOpenChange} />
  );
const open = async () => {
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseAndStartFresh' }));
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
};
const acknowledge = async () => {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('checkbox', { name: 'start.eraseAcknowledge' })
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Type ERASE to confirm.' }),
    'ERASE'
  );
};

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof ResizeObserver;
  jest.clearAllMocks();
  mockEmitter.mockImplementation(([group, method]) => {
    expect(group).toBe('wallet');
    if (method === 'beginLockedWalletReset') return Promise.resolve(TICKET);
    if (method === 'resetLockedWallet') return Promise.resolve(true);
    throw new Error('Unexpected controller method');
  });
  window.matchMedia = jest.fn().mockReturnValue({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  jest.restoreAllMocks();
});

it('opens only a non-destructive warning, focuses Cancel and keeps admission out of persisted navigation', async () => {
  mount();
  expect(mockEmitter).not.toHaveBeenCalled();
  await open();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'beginLockedWalletReset'],
    [],
    10000,
    false
  );
  expect(resetCalls()).toHaveLength(0);
  expect(mockOpenChange).toHaveBeenCalledWith(true);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.cancel' })).toHaveFocus()
  );
  expect(screen.getByRole('dialog')).toHaveAccessibleName('start.eraseConfirm');
  expect(
    screen.getByRole('button', { name: 'start.eraseConfirm' })
  ).toBeDisabled();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(document.body.textContent).not.toContain(TICKET);
  expect(
    JSON.stringify({
      history: window.history.state,
      url: window.location.href,
      localStorage,
      sessionStorage,
    })
  ).not.toContain(TICKET);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mockOpenChange).toHaveBeenLastCalledWith(false);
  expect(resetCalls()).toHaveLength(0);
  expect(mockClear).not.toHaveBeenCalled();
});

it('Escape closes an unsubmitted warning and restores focus to its trigger', async () => {
  mount();
  await open();
  await userEvent.setup().keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    screen.getByRole('button', { name: 'start.eraseAndStartFresh' })
  ).toHaveFocus();
  expect(resetCalls()).toHaveLength(0);
});

it('requires acknowledgement and exact ERASE before making one explicit reset request', async () => {
  mount();
  await open();
  const confirm = screen.getByRole('button', { name: 'start.eraseConfirm' });
  const field = screen.getByRole('textbox', { name: 'Type ERASE to confirm.' });
  const user = userEvent.setup();
  await user.type(field, 'ERASE');
  expect(confirm).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  await user.clear(field);
  await user.type(field, 'erase');
  expect(confirm).toBeDisabled();
  fireEvent.submit(document.getElementById('erase-wallet-confirmation')!);
  expect(resetCalls()).toHaveLength(0);
  await user.clear(field);
  await user.type(field, 'ERASE');
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  expect(resetCalls()).toEqual([
    [['wallet', 'resetLockedWallet'], [TICKET, 'ERASE'], 10000, false],
  ]);
  expect(mockClear).toHaveBeenCalledTimes(1);
});

it('supports native Enter submission without a second destructive request', async () => {
  mount();
  await open();
  await acknowledge();
  await userEvent.setup().type(screen.getByRole('textbox'), '{Enter}');
  await waitFor(() => expect(resetCalls()).toHaveLength(1));
  expect(mockReload).toHaveBeenCalledTimes(1);
});

it('keeps duplicate submits, Cancel and Escape inert while the reset is pending', async () => {
  const response = deferred<boolean>();
  mockEmitter.mockImplementation(([, method]) =>
    method === 'beginLockedWalletReset'
      ? Promise.resolve(TICKET)
      : response.promise
  );
  mount();
  await open();
  await acknowledge();
  const form = document.getElementById('erase-wallet-confirmation')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(resetCalls()).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'buttons.cancel' })).toBeDisabled();
  await userEvent.setup().keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(mockOpenChange).not.toHaveBeenCalledWith(false);
  await act(async () => response.resolve(true));
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(resetCalls()).toHaveLength(1);
});

it('does not replay an ambiguous reset and offers only an authoritative wallet check', async () => {
  mockEmitter.mockImplementation(([, method]) =>
    method === 'beginLockedWalletReset'
      ? Promise.resolve(TICKET)
      : Promise.reject(new Error('Transport failure with untrusted details'))
  );
  mount();
  await open();
  await acknowledge();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseConfirm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'start.eraseUncertain'
  );
  expect(
    screen.queryByRole('button', { name: 'start.eraseConfirm' })
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.cancel' })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.queryByText('Transport failure with untrusted details')
  ).toBeNull();
  expect(mockReload).not.toHaveBeenCalled();
  await userEvent.setup().keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.checkWallet' }));
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(resetCalls()).toHaveLength(1);
});

it('treats a non-true reset acknowledgement as uncertain, never as completed', async () => {
  mockEmitter.mockImplementation(([, method]) =>
    Promise.resolve(method === 'beginLockedWalletReset' ? TICKET : false)
  );
  mount();
  await open();
  await acknowledge();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseConfirm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'start.eraseUncertain'
  );
  expect(mockReload).not.toHaveBeenCalled();
  expect(resetCalls()).toHaveLength(1);
});

it('discards a cancelled admission response and requires fresh acknowledgement on reopen', async () => {
  const first = deferred<string>();
  mockEmitter
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce('fresh-admission');
  mount();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseAndStartFresh' }));
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await act(async () => first.resolve('stale-admission'));
  expect(screen.queryByRole('dialog')).toBeNull();
  await open();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(resetCalls()).toHaveLength(0);
  await acknowledge();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseConfirm' }));
  await waitFor(() => expect(resetCalls()).toHaveLength(1));
  expect(resetCalls()[0][1]).toEqual(['fresh-admission', 'ERASE']);
});

it('reports a preparation failure without exposing server text or enabling reset', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('private server detail'));
  mount();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseAndStartFresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'start.eraseFailed'
  );
  expect(screen.queryByText('private server detail')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'start.eraseConfirm' })
  ).toBeDisabled();
  expect(resetCalls()).toHaveLength(0);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await open();
  expect(screen.getByRole('checkbox')).toBeEnabled();
});

it('keeps a disabled entry inert without asking the background for admission', async () => {
  mount(true);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseAndStartFresh' }));
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('discards late admission after document hiding without submitting a reset', async () => {
  const response = deferred<string>();
  mockEmitter.mockReturnValueOnce(response.promise);
  mount();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'start.eraseAndStartFresh' }));
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => response.resolve(TICKET));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(resetCalls()).toHaveLength(0);
});

it('keeps hidden in-flight reset uncertain even when its late response succeeds', async () => {
  const response = deferred<boolean>();
  mockEmitter.mockImplementation(([, method]) =>
    method === 'beginLockedWalletReset'
      ? Promise.resolve(TICKET)
      : response.promise
  );
  mount();
  await open();
  await acknowledge();
  fireEvent.submit(document.getElementById('erase-wallet-confirmation')!);
  fireEvent(window, new Event('pagehide'));
  await act(async () => response.resolve(true));
  expect(screen.getByRole('alert')).toHaveTextContent('start.eraseUncertain');
  expect(mockReload).not.toHaveBeenCalled();
  expect(resetCalls()).toHaveLength(1);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'buttons.checkWallet' }));
  expect(mockReload).toHaveBeenCalledTimes(1);
});

it('does not reload from a reset response after the component unmounts', async () => {
  const response = deferred<boolean>();
  mockEmitter.mockImplementation(([, method]) =>
    method === 'beginLockedWalletReset'
      ? Promise.resolve(TICKET)
      : response.promise
  );
  const view = mount();
  await open();
  await acknowledge();
  fireEvent.submit(document.getElementById('erase-wallet-confirmation')!);
  view.unmount();
  await act(async () => response.resolve(true));
  expect(mockReload).not.toHaveBeenCalled();
  expect(resetCalls()).toHaveLength(1);
});
