/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import en from 'assets/locales/en.json';
import { NOTE_BACKUP_FILE_LIMIT } from 'utils/privacy/noteBackupWire';

import PrivateNoteBundleDialog from './PrivateNoteBundleDialog';

const copy = en.privacy.bundle;
const ID = '00000000-0000-4000-8000-000000000001';
const SECRET = 'tornado-eth-1-1-0x-secret-must-not-render';
const WALLET_PASSWORD = 'wallet-password';
const FILE_PASSWORD = 'separate file password';
const FILE_DATA = btoa(String.fromCharCode(...new Uint8Array(96).fill(12)));
const SUMMARY = {
  id: ID,
  added: 2,
  duplicates: 1,
  guarded: 2,
  expiresAt: 300000,
};
const mockEmitter = jest.fn();
const mockClose = jest.fn();
const mockRestored = jest.fn();
let mockState: any;
let mockStatus: any;
let visible = true;
const mockTranslate = (key: string, values: any = {}) =>
  String(
    key.split('.').reduce((value: any, part) => value?.[part], en) || key
  ).replace(/{{(\w+)}}/g, (_, name) => String(values[name]));
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
const originalCreateUrl = URL.createObjectURL;
const originalRevokeUrl = URL.revokeObjectURL;
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
  URL.createObjectURL = jest.fn(() => 'blob:encrypted-backup');
  URL.revokeObjectURL = jest.fn();
});
afterAll(() => {
  window.matchMedia = originalMatchMedia;
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  URL.createObjectURL = originalCreateUrl;
  URL.revokeObjectURL = originalRevokeUrl;
  delete (document as any).visibilityState;
});
beforeEach(() => {
  visible = true;
  mockClose.mockReset();
  mockRestored.mockReset();
  jest.mocked(URL.createObjectURL).mockClear();
  jest.mocked(URL.revokeObjectURL).mockClear();
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
  mockEmitter.mockReset().mockImplementation(async ([, method]) => {
    if (method === 'begin') return ID;
    if (method === 'cancel') return undefined;
    if (method === 'exportEncrypted')
      return {
        id: ID,
        file: FILE_DATA,
        noteCount: 3,
        createdAt: 123,
        note: SECRET,
      };
    if (method === 'prepareImport') return { ...SUMMARY, note: SECRET };
    if (method === 'commitImport')
      return { ...SUMMARY, confirmed: true, note: SECRET };
    if (method === 'verifyExport')
      return { id: ID, verified: true, noteCount: 3, createdAt: 123 };
    if (method === 'readCommitReceipt') return null;
    throw new Error('Unexpected method');
  });
});
afterEach(() => jest.restoreAllMocks());
const dialog = (mode: 'export' | 'import' | null = 'export') => (
  <PrivateNoteBundleDialog
    mode={mode}
    onClose={mockClose}
    onRestored={mockRestored}
  />
);
const fillExport = (password = FILE_PASSWORD, confirmation = password) => {
  fireEvent.change(screen.getByLabelText(copy.walletPassword), {
    target: { value: WALLET_PASSWORD },
  });
  fireEvent.change(screen.getByLabelText(copy.filePassword), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(copy.confirmPassword), {
    target: { value: confirmation },
  });
};
const selectFile = (size = 96) => {
  const file = new File([new Uint8Array(96).fill(12)], 'neutral.palibak', {
    type: 'application/octet-stream',
  });
  const read = jest.fn(async () => new Uint8Array(96).fill(12).buffer);
  Object.defineProperty(file, 'arrayBuffer', { value: read });
  Object.defineProperty(file, 'size', { value: size });
  fireEvent.change(screen.getByLabelText(copy.selectFile), {
    target: { files: [file] },
  });
  return { file, read };
};
const createExport = async () => {
  fillExport();
  fireEvent.click(screen.getByRole('button', { name: copy.createFile }));
  await screen.findByRole('button', { name: copy.saveFile });
};
const previewImport = async () => {
  selectFile();
  fireEvent.change(screen.getByLabelText(copy.filePassword), {
    target: { value: FILE_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.reviewImport }));
  await screen.findByRole('button', { name: copy.confirmRestore });
};

it('requires explicit encrypted export and save, reports a handoff, and revokes the URL on close', async () => {
  let downloadedName = '';
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download;
    });
  render(dialog());
  expect(mockEmitter).not.toHaveBeenCalled();
  await createExport();
  expect(click).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(copy.walletPassword)).not.toBeInTheDocument();
  expect(screen.getByLabelText(copy.filePassword)).toHaveValue('');
  expect(document.body.textContent).not.toContain(SECRET);
  fireEvent.click(screen.getByRole('button', { name: copy.saveFile }));
  expect(click).toHaveBeenCalledTimes(1);
  expect(downloadedName).toBe('pali-private-notes.palibak');
  expect(screen.getByText(copy.handoff)).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'exportEncrypted'],
    [ID, WALLET_PASSWORD, FILE_PASSWORD],
    120000,
    false
  );
  fireEvent.click(screen.getAllByRole('button', { name: en.buttons.close })[0]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:encrypted-backup');
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'cancel'],
    [ID],
    120000,
    false
  );
});

it('verifies only a user-selected saved file and clears its password after the attempt', async () => {
  render(dialog());
  await createExport();
  expect(screen.getByRole('button', { name: copy.verifyFile })).toBeDisabled();
  selectFile();
  fireEvent.change(screen.getByLabelText(copy.filePassword), {
    target: { value: FILE_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.verifyFile }));
  expect(await screen.findByText(copy.verified)).toBeVisible();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'verifyExport'],
    [ID, FILE_DATA, FILE_PASSWORD],
    120000,
    false
  );
  expect(screen.queryByLabelText(copy.filePassword)).not.toBeInTheDocument();
});

it.each(['mismatch', 'short', 'bytes', 'surrogate'])(
  'rejects %s file passwords before reserving an operation',
  (kind) => {
    render(dialog());
    const password =
      kind === 'short'
        ? 'short'
        : kind === 'bytes'
        ? '🔐'.repeat(300)
        : kind === 'surrogate'
        ? 'long password\ud800'
        : FILE_PASSWORD;
    fillExport(password, kind === 'mismatch' ? 'different password' : password);
    fireEvent.click(screen.getByRole('button', { name: copy.createFile }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      kind === 'mismatch' ? copy.passwordMismatch : copy.passwordInvalid
    );
    expect(mockEmitter).not.toHaveBeenCalled();
  }
);

it('preserves exact Unicode and whitespace file passwords', async () => {
  render(dialog());
  const password = '  🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐  ';
  fillExport(password);
  fireEvent.click(screen.getByRole('button', { name: copy.createFile }));
  await screen.findByRole('button', { name: copy.saveFile });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'exportEncrypted'],
    [ID, WALLET_PASSWORD, password],
    120000,
    false
  );
});

it('checks the file size before reading or sending it', () => {
  render(dialog('import'));
  const { read } = selectFile(NOTE_BACKUP_FILE_LIMIT + 1);
  expect(screen.getByRole('alert')).toHaveTextContent(copy.fileTooLarge);
  expect(read).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: copy.reviewImport })
  ).toBeDisabled();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('previews public counts only, then requires fresh wallet authentication for a single commit', async () => {
  render(dialog('import'));
  expect(screen.queryByLabelText(copy.walletPassword)).not.toBeInTheDocument();
  await previewImport();
  expect(
    screen.getByText(mockTranslate('privacy.bundle.summary', SUMMARY))
  ).toBeVisible();
  expect(screen.getByText(copy.reconciliation)).toBeVisible();
  expect(document.body.textContent).not.toContain(SECRET);
  fireEvent.change(screen.getByLabelText(copy.walletPassword), {
    target: { value: WALLET_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirmRestore }));
  expect(await screen.findByText(copy.restored)).toBeVisible();
  expect(mockRestored).toHaveBeenCalledTimes(1);
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'commitImport')
  ).toHaveLength(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'commitImport'],
    [ID, WALLET_PASSWORD],
    120000,
    false
  );
  for (const [, , timeout, retry] of mockEmitter.mock.calls) {
    expect(timeout).toBeGreaterThanOrEqual(120000);
    expect(retry).toBe(false);
  }
});

it('keeps an ambiguous commit unconfirmed after null or stale receipts and never resubmits it', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, ...args) => {
    if (path[1] === 'commitImport')
      throw new Error('BACKUP_COMMIT_UNCONFIRMED');
    return original(path, ...args);
  });
  render(dialog('import'));
  await previewImport();
  fireEvent.change(screen.getByLabelText(copy.walletPassword), {
    target: { value: WALLET_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirmRestore }));
  expect(await screen.findByText(copy.unconfirmed)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: copy.checkReceipt }));
  expect(await screen.findByText(copy.receiptUnavailable)).toBeVisible();
  mockEmitter.mockImplementation(async (path, ...args) => {
    if (path[1] === 'readCommitReceipt') throw new Error('BACKUP_STALE');
    return original(path, ...args);
  });
  fireEvent.click(screen.getByRole('button', { name: copy.checkReceipt }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: copy.checkReceipt })
    ).toBeEnabled()
  );
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'commitImport')
  ).toHaveLength(1);
  expect(mockRestored).not.toHaveBeenCalled();
});

it('confirms a lost-ack restore only from a matching receipt', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, ...args) => {
    if (path[1] === 'commitImport')
      throw new Error('Network request timed out');
    if (path[1] === 'readCommitReceipt')
      return { ...SUMMARY, confirmed: true, note: SECRET };
    return original(path, ...args);
  });
  render(dialog('import'));
  await previewImport();
  fireEvent.change(screen.getByLabelText(copy.walletPassword), {
    target: { value: WALLET_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirmRestore }));
  fireEvent.click(
    await screen.findByRole('button', { name: copy.checkReceipt })
  );
  expect(await screen.findByText(copy.restored)).toBeVisible();
  expect(document.body.textContent).not.toContain(SECRET);
  expect(mockRestored).toHaveBeenCalledTimes(1);
});

it('requires a new preview after authentication failure instead of replaying the consumed token', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, ...args) => {
    if (path[1] === 'commitImport')
      throw new Error('BACKUP_AUTHENTICATION_FAILED');
    return original(path, ...args);
  });
  render(dialog('import'));
  await previewImport();
  fireEvent.change(screen.getByLabelText(copy.walletPassword), {
    target: { value: 'wrong' },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirmRestore }));
  expect(await screen.findByText(copy.authentication)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: copy.confirmRestore })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: copy.startAgain }));
  expect(screen.getByLabelText(copy.filePassword)).toHaveValue('');
  expect(
    screen.getByRole('button', { name: copy.reviewImport })
  ).toBeDisabled();
});

it('cancels a late begin response after closing, without starting encryption', async () => {
  const pending = deferred();
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, ...args) =>
    path[1] === 'begin' ? pending.promise : original(path, ...args)
  );
  render(dialog());
  fillExport();
  fireEvent.click(screen.getByRole('button', { name: copy.createFile }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole('button', { name: en.buttons.close })[0]);
  await act(async () => pending.resolve(ID));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'cancel'],
    [ID],
    120000,
    false
  );
  expect(
    mockEmitter.mock.calls.some(([[, method]]) => method === 'exportEncrypted')
  ).toBe(false);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it.each(['hidden', 'pagehide', 'lock', 'account', 'network', 'unmount'])(
  'clears credentials and rejects late export after %s',
  async (reason) => {
    const pending = deferred();
    const original = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation((path, ...args) =>
      path[1] === 'exportEncrypted' ? pending.promise : original(path, ...args)
    );
    const view = render(dialog());
    fillExport();
    fireEvent.click(screen.getByRole('button', { name: copy.createFile }));
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([[, method]]) => method === 'exportEncrypted'
        )
      ).toBe(true)
    );
    if (reason === 'hidden') {
      visible = false;
      fireEvent(document, new Event('visibilitychange'));
    } else if (reason === 'pagehide') fireEvent(window, new Event('pagehide'));
    else if (reason === 'unmount') view.unmount();
    else {
      if (reason === 'lock') mockStatus.isUnlocked = false;
      if (reason === 'account') mockState.vault.activeAccount.id = 1;
      if (reason === 'network')
        mockState.vault.activeNetwork.url = 'https://other.test';
      view.rerender(dialog());
    }
    await act(async () =>
      pending.resolve({
        id: ID,
        file: FILE_DATA,
        noteCount: 3,
        createdAt: 123,
        note: SECRET,
      })
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledWith(
      ['noteBackups', 'cancel'],
      [ID],
      120000,
      false
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

it('uses the real dialog Escape handler to cancel the active operation', async () => {
  render(dialog());
  await createExport();
  await userEvent.keyboard('{Escape}');
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'cancel'],
    [ID],
    120000,
    false
  );
});

it('does not save an empty authoritative export', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, ...args) =>
    path[1] === 'exportEncrypted'
      ? Promise.resolve({
          id: ID,
          file: FILE_DATA,
          createdAt: 123,
          noteCount: 0,
        })
      : original(path, ...args)
  );
  render(dialog());
  fillExport();
  fireEvent.click(screen.getByRole('button', { name: copy.createFile }));
  expect(await screen.findByText(copy.empty)).toBeVisible();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['noteBackups', 'cancel'],
    [ID],
    120000,
    false
  );
});

it('wipes a late file read and never starts an import after unmount', async () => {
  const read = deferred();
  const bytes = new Uint8Array(96).fill(12);
  const local = new File([bytes], 'neutral.palibak');
  Object.defineProperty(local, 'arrayBuffer', { value: () => read.promise });
  const view = render(dialog('import'));
  fireEvent.change(screen.getByLabelText(copy.selectFile), {
    target: { files: [local] },
  });
  fireEvent.change(screen.getByLabelText(copy.filePassword), {
    target: { value: FILE_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.reviewImport }));
  view.unmount();
  await act(async () => read.resolve(bytes.buffer));
  expect(bytes.every((byte) => byte === 0)).toBe(true);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not accept a receipt whose counts differ from the reviewed import', async () => {
  const original = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, ...args) => {
    if (path[1] === 'commitImport')
      throw new Error('Network request timed out');
    if (path[1] === 'readCommitReceipt')
      return { ...SUMMARY, added: 3, confirmed: true };
    return original(path, ...args);
  });
  render(dialog('import'));
  await previewImport();
  fireEvent.change(screen.getByLabelText(copy.walletPassword), {
    target: { value: WALLET_PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: copy.confirmRestore }));
  fireEvent.click(
    await screen.findByRole('button', { name: copy.checkReceipt })
  );
  expect(await screen.findByText(copy.receiptUnavailable)).toBeVisible();
  expect(screen.getByText(copy.unconfirmed)).toBeVisible();
  expect(mockRestored).not.toHaveBeenCalled();
});
