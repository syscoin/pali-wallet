/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import en from 'assets/locales/en.json';

import PrivateNoteBackupDialog from './PrivateNoteBackupDialog';

const mockEmitter = jest.fn();
const mockClose = jest.fn();
const mockCopy = jest.fn();
let mockState: any;
let mockStatus: any;
let visible = true;
const NOTE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_NOTE_ID = '00000000-0000-4000-8000-000000000002';
const SECRET = 'synthetic-private-note';
const mockTranslate = (key: string) =>
  String(key.split('.').reduce((value: any, part) => value?.[part], en) || key);
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter, ...mockStatus }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('components/Button', () => ({
  Button: jest
    .requireActual('react')
    .forwardRef(function MockButton(
      { children, loading, fullWidth, variant, ...props }: any,
      ref: any
    ) {
      return (
        <button
          {...props}
          ref={ref}
          aria-busy={loading || undefined}
          data-full-width={fullWidth}
          data-variant={variant}
        >
          {children}
        </button>
      );
    }),
}));
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockCopy },
  });
});
afterAll(() => {
  window.matchMedia = originalMatchMedia;
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  delete (document as any).visibilityState;
  delete (navigator as any).clipboard;
});
beforeEach(() => {
  visible = true;
  mockClose.mockReset();
  mockCopy.mockReset();
  mockEmitter.mockReset().mockResolvedValue(SECRET);
  mockStatus = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockState = {
    vault: {
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: {
        HDAccount: {
          0: { address: 'account-a', xpub: 'public-a' },
          1: { address: 'account-b', xpub: 'public-b' },
        },
      },
      activeNetwork: { chainId: 1, url: 'https://rpc.test' },
    },
    vaultGlobal: { lastLogin: 1, activeSlip44: 60 },
  };
});
const dialog = (noteId: string | null = NOTE_ID) => (
  <PrivateNoteBackupDialog noteId={noteId} onClose={mockClose} />
);
function confirm(password = 'test-password') {
  fireEvent.change(screen.getByLabelText(en.privacy.revealPassword), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
}

it('reveals only after explicit password confirmation and never copies or downloads', async () => {
  render(dialog());
  expect(
    screen.getByRole('dialog', { name: en.privacy.revealNote })
  ).toBeVisible();
  expect(screen.getByText(en.privacy.deposit.backupWarning)).toBeVisible();
  expect(mockEmitter).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(en.privacy.revealPassword), {
    target: { value: 'test-password' },
  });
  expect(mockEmitter).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: en.buttons.confirm }));
  const note = await screen.findByLabelText(en.privacy.privateNote);
  expect(note).toHaveValue(SECRET);
  expect(note).toHaveAttribute('readonly');
  expect(
    screen.queryByLabelText(en.privacy.revealPassword)
  ).not.toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['privateVault', 'revealNote'],
    [NOTE_ID, 'test-password'],
    30000,
    false
  );
  expect(mockCopy).not.toHaveBeenCalled();
  expect(document.querySelector('[download]')).toBeNull();
  expect(mockClose).not.toHaveBeenCalled();
});

it('clears a revealed note on Hide and opens a fresh password form next time', async () => {
  const view = render(dialog());
  confirm();
  await screen.findByDisplayValue(SECRET);
  fireEvent.click(screen.getByRole('button', { name: en.privacy.hideNote }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
  expect(mockClose).toHaveBeenCalledTimes(1);
  view.rerender(dialog(null));
  view.rerender(dialog());
  expect(screen.getByLabelText(en.privacy.revealPassword)).toHaveValue('');
  expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('uses the real dialog Escape handler and never automatically authenticates on reopen', async () => {
  const view = render(dialog());
  await userEvent.keyboard('{Escape}');
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  view.rerender(dialog(null));
  view.rerender(dialog());
  expect(screen.getByLabelText(en.privacy.revealPassword)).toHaveValue('');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each([
  'hide',
  'hidden',
  'pagehide',
  'lock',
  'account',
  'network',
  'profile',
  'unmount',
])('ignores delayed plaintext after %s', async (change) => {
  const pending = deferred();
  mockEmitter.mockReturnValue(pending.promise);
  const view = render(dialog());
  confirm();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  if (change === 'hide') {
    fireEvent.click(screen.getByRole('button', { name: en.privacy.hideNote }));
  } else if (change === 'hidden') {
    visible = false;
    fireEvent(document, new Event('visibilitychange'));
  } else if (change === 'pagehide') {
    fireEvent(window, new Event('pagehide'));
  } else if (change === 'unmount') {
    view.unmount();
  } else {
    if (change === 'lock') mockStatus.isUnlocked = false;
    if (change === 'account') mockState.vault.activeAccount.id = 1;
    if (change === 'network')
      mockState.vault.activeNetwork.url = 'https://other.test';
    if (change === 'profile') mockState.vaultGlobal.lastLogin = 2;
    view.rerender(dialog());
  }
  await act(async () => pending.resolve(SECRET));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
  if (change === 'unmount') return;
  visible = true;
  mockStatus.isUnlocked = true;
  fireEvent(document, new Event('visibilitychange'));
  view.rerender(dialog(null));
  view.rerender(dialog());
  expect(screen.getByLabelText(en.privacy.revealPassword)).toHaveValue('');
  expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('clears secrets when another note is selected and ignores the old note response', async () => {
  const pending = deferred();
  mockEmitter
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce('other-note');
  const view = render(dialog());
  confirm();
  view.rerender(dialog(OTHER_NOTE_ID));
  expect(screen.getByLabelText(en.privacy.revealPassword)).toHaveValue('');
  await act(async () => pending.resolve(SECRET));
  expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
  confirm('other-password');
  expect(await screen.findByDisplayValue('other-note')).toBeVisible();
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['privateVault', 'revealNote'],
    [OTHER_NOTE_ID, 'other-password'],
    30000,
    false
  );
});

it('sanitizes controller failures before the shared password input logs them', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    mockEmitter.mockRejectedValue(
      new Error('private-note-and-password-must-not-leak')
    );
    render(dialog());
    confirm();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      en.privacy.noteRevealFailed
    );
    expect(
      screen.queryByText(/private-note-and-password/)
    ).not.toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(
      'Password validation error:',
      new Error('privacy_note_reveal_failed')
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'private-note-and-password'
    );
  } finally {
    log.mockRestore();
  }
});
