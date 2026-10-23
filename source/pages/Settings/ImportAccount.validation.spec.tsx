/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { validatePrivateKeyValue } from 'utils/validatePrivateKey';

import ImportAccount from './ImportAccount';

const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn() };
const PUBLIC_ADDRESS = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';

// Use AntD's actual CommonJS-exported form hook in this Node test environment.
jest.mock('antd/es/form/Form', () => ({
  useForm: jest.requireActual('antd').Form.useForm,
}));
jest.mock('react-redux', () => ({
  useSelector: (selector: any) =>
    selector({
      vault: {
        accounts: {
          HDAccount: { 0: { id: 0, address: 'public-fixture-address' } },
        },
        activeAccount: { type: 'HDAccount', id: 0 },
        isBitcoinBased: true,
        activeNetwork: { chainId: 5700, url: 'https://fixture.invalid' },
      },
    }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings/account/import' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('utils/index', () => ({
  extractErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('utils/validatePrivateKey', () => ({
  validatePrivateKeyValue: jest.fn(),
}));
jest.mock('components/index', () => ({
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ImportedWalletSuccessfully: ({ show }: any) =>
    show ? <div role="status">Imported</div> : null,
}));

const pendingValidation = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const input = () => screen.getByPlaceholderText('settings.yourPrivateKey');
const importButton = () =>
  screen.getByRole('button', { name: 'buttons.import' });
const submitForm = () => fireEvent.submit(document.querySelector('form')!);

const originalMessageChannel = globalThis.MessageChannel;
beforeAll(() => {
  // Preserve the real form's asynchronous watcher ordering in JSDOM.
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
});

beforeEach(() => {
  jest.clearAllMocks();
  (validatePrivateKeyValue as jest.Mock).mockResolvedValue(true);
  // Production keeps public parsing in the background; this real form test
  // controls the internal local-only validation response, not the parser.
  mockEmitter.mockImplementation(async (method, args) =>
    method[1] === 'validateWatchOnlyIdentifier'
      ? args[0] === PUBLIC_ADDRESS
      : { id: 1 }
  );
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
});

it('associates the watch-only label and gives each import field a unique accessible identity', async () => {
  const { container } = render(<ImportAccount />);
  const label = screen.getByRole('textbox', {
    name: 'settings.label (settings.optional)',
  });
  const privateKey = screen.getByLabelText('settings.yourPrivateKey');
  const watchOnly = screen.getByRole('checkbox', {
    name: 'settings.watchOnly',
  }) as HTMLInputElement;
  expect(label.id).toBe('account-name-input');
  expect(privateKey.id).toBe('import-account-identifier');
  expect(watchOnly.id).toBe('import-account-watch-only');
  expect(
    container.querySelector('label[for="import-account-watch-only"]')
  ).not.toBeNull();
  const ids = [...container.querySelectorAll('[id]')].map(
    (element) => element.id
  );
  expect(new Set(ids).size).toBe(ids.length);
  fireEvent.click(screen.getByText('settings.watchOnly'));
  expect(watchOnly.checked).toBe(true);
  expect(
    screen.getByRole('textbox', { name: 'settings.publicIdentifierInput' }).id
  ).toBe('import-account-identifier');
});

it('masks private input by default and reveals only through its explicit non-submit control', async () => {
  render(<ImportAccount />);
  const privateKey = input() as HTMLInputElement;
  fireEvent.change(privateKey, {
    target: { value: 'synthetic-private-input' },
  });
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  expect(privateKey.type).toBe('password');
  expect(privateKey.autocomplete).toBe('off');
  const show = screen.getByRole('button', {
    name: 'sentry.showPrivateKeys',
  }) as HTMLButtonElement;
  expect(show.type).toBe('button');
  fireEvent.click(show);
  expect(privateKey.type).toBe('text');
  expect(privateKey.value).toBe('synthetic-private-input');
  expect(
    screen
      .getByRole('button', { name: 'sentry.hidePrivateKeys' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  fireEvent.click(
    screen.getByRole('button', { name: 'sentry.hidePrivateKeys' })
  );
  expect(privateKey.type).toBe('password');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not expose a private draft when switching modes, including a previously revealed draft', async () => {
  render(<ImportAccount />);
  const privateKey = input() as HTMLInputElement;
  fireEvent.change(privateKey, {
    target: { value: 'synthetic-private-input' },
  });
  await waitFor(() => expect(validatePrivateKeyValue).toHaveBeenCalled());
  fireEvent.click(
    screen.getByRole('button', { name: 'sentry.showPrivateKeys' })
  );
  fireEvent.click(screen.getByRole('checkbox'));
  const publicInput = screen.getByLabelText(
    'settings.publicIdentifierInput'
  ) as HTMLInputElement;
  expect(publicInput.type).toBe('password');
  expect(publicInput.value).toBe('synthetic-private-input');
  expect(
    screen.getByRole('button', { name: 'sentry.showPrivateKeys' })
  ).toBeTruthy();
  fireEvent.change(publicInput, {
    target: { value: 'synthetic-private-input-edited' },
  });
  expect(publicInput.type).toBe('password');
  fireEvent.change(publicInput, { target: { value: '' } });
  expect(publicInput.type).toBe('text');
  fireEvent.change(publicInput, { target: { value: PUBLIC_ADDRESS } });
  expect(publicInput.type).toBe('text');
  expect(
    screen.queryByRole('button', { name: 'sentry.showPrivateKeys' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(privateKey.type).toBe('password');
  expect(privateKey.value).toBe(PUBLIC_ADDRESS);
});

it('keeps the real submit button associated without adding margin below its footer', () => {
  const { container } = render(<ImportAccount />);
  const form = container.querySelector('form')!;
  const button = importButton() as HTMLButtonElement;
  expect(button.type).toBe('submit');
  expect(button.form).toBe(form);
  expect(form.contains(button)).toBe(true);
  expect(
    form.contains(container.querySelector('[data-page-action-footer]'))
  ).toBe(true);
  expect(form.classList.contains('mb-10')).toBe(false);
});

it('does not re-enable import or remain busy when an old validation succeeds after the field is cleared', async () => {
  const validation = pendingValidation();
  (validatePrivateKeyValue as jest.Mock).mockImplementation((value) =>
    value === 'synthetic-old-valid-input'
      ? validation.promise
      : Promise.resolve(false)
  );
  render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: 'synthetic-old-valid-input' } });
  await waitFor(() => expect(validatePrivateKeyValue).toHaveBeenCalled());
  fireEvent.change(input(), { target: { value: '' } });
  await act(async () => validation.resolve(true));

  expect(importButton().hasAttribute('disabled')).toBe(true);
  await act(async () => submitForm());
  expect(importButton().getAttribute('aria-busy')).not.toBe('true');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not accept a late successful validation over a newer invalid value', async () => {
  const old = pendingValidation();
  (validatePrivateKeyValue as jest.Mock).mockImplementation((value) =>
    value === 'synthetic-old-valid-input' ? old.promise : Promise.resolve(false)
  );
  render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: 'synthetic-old-valid-input' } });
  await waitFor(() => expect(validatePrivateKeyValue).toHaveBeenCalledTimes(1));
  fireEvent.change(input(), { target: { value: 'invalid-new-input' } });
  await waitFor(() => expect(validatePrivateKeyValue).toHaveBeenCalledTimes(2));
  await act(async () => old.resolve(true));
  expect(importButton().hasAttribute('disabled')).toBe(true);
});

it('revalidates an existing nonempty value when switching to watch-only mode', async () => {
  (validatePrivateKeyValue as jest.Mock).mockResolvedValue(false);
  render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: PUBLIC_ADDRESS } });
  await waitFor(() => expect(validatePrivateKeyValue).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('checkbox'));
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  fireEvent.click(importButton());
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'importWatchOnlyFromController'],
      [PUBLIC_ADDRESS, undefined]
    )
  );
});

it('imports the validated current private input with its selected address type', async () => {
  render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: 'synthetic-current-input' } });
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  fireEvent.click(
    screen.getByRole('radio', { name: 'settings.legacyAddressType' })
  );
  fireEvent.click(importButton());
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'importAccountFromPrivateKey'],
      ['synthetic-current-input', undefined, { utxoAddressType: 'p2pkh' }]
    )
  );
  expect((await screen.findByRole('status')).textContent).toBe('Imported');
});

it('submits the valid form through the same guarded private-key import action', async () => {
  const { container } = render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: 'synthetic-current-input' } });
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'importAccountFromPrivateKey'],
      ['synthetic-current-input', undefined, { utxoAddressType: 'p2wpkh' }]
    )
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('submits a watch-only form without invoking private-key import', async () => {
  const { container } = render(<ImportAccount />);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(
    screen.getByPlaceholderText('settings.publicIdentifierInput'),
    {
      target: { value: PUBLIC_ADDRESS },
    }
  );
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'importWatchOnlyFromController'],
      [PUBLIC_ADDRESS, undefined]
    )
  );
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'importWatchOnlyFromController'
    )
  ).toHaveLength(1);
  expect(
    mockEmitter.mock.calls.some(
      ([methods]) => methods[1] === 'importAccountFromPrivateKey'
    )
  ).toBe(false);
});

it('admits only one import while the current request remains pending', async () => {
  const finishes: Array<(value: unknown) => void> = [];
  mockEmitter.mockImplementation(
    () => new Promise((resolve) => finishes.push(resolve))
  );
  render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: 'synthetic-current-input' } });
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  act(() => {
    submitForm();
    submitForm();
  });
  try {
    await waitFor(() => expect(mockEmitter).toHaveBeenCalledTimes(1));
  } finally {
    await act(async () => {
      finishes.forEach((finish) => finish({ id: 1 }));
    });
  }
  await waitFor(() =>
    expect(importButton().getAttribute('aria-busy')).not.toBe('true')
  );
});

it('does not enter a loading state or issue an import for an empty input', async () => {
  render(<ImportAccount />);
  await act(async () => submitForm());
  expect(importButton().getAttribute('aria-busy')).not.toBe('true');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('clears a failed import and permits a fresh validated retry', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Synthetic import failure'));
  render(<ImportAccount />);
  fireEvent.change(input(), { target: { value: 'synthetic-current-input' } });
  await waitFor(() =>
    expect(importButton().hasAttribute('disabled')).toBe(false)
  );
  fireEvent.click(importButton());
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
  expect(importButton().getAttribute('aria-busy')).not.toBe('true');
  expect(input().getAttribute('disabled')).toBeNull();
  fireEvent.click(importButton());
  expect((await screen.findByRole('status')).textContent).toBe('Imported');
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});

it.each([
  ['private hex', `0x${'11'.repeat(32)}`],
  ['WIF', 'L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1'],
  [
    'private descriptor',
    'wpkh(L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1)',
  ],
])(
  'refuses %s in watch-only mode without an import/backend call',
  async (_label, value) => {
    render(<ImportAccount />);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(
      screen.getByPlaceholderText('settings.publicIdentifierInput'),
      {
        target: { value },
      }
    );
    // Wait for AntD's actual validation result, not just the initially disabled UI.
    expect(
      await screen.findByText('settings.invalidWatchOnlyIdentifier')
    ).toBeTruthy();
    expect(importButton().hasAttribute('disabled')).toBe(true);
    await act(async () => submitForm());
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'validateWatchOnlyIdentifier'],
      [value]
    );
    expect(
      mockEmitter.mock.calls.every(
        ([method]) => method[1] === 'validateWatchOnlyIdentifier'
      )
    ).toBe(true);
  }
);

it('ignores late successful background validation after the public input changes', async () => {
  const old = pendingValidation();
  mockEmitter.mockImplementation(async (method, args) => {
    if (method[1] === 'validateWatchOnlyIdentifier')
      return args[0] === PUBLIC_ADDRESS ? old.promise : false;
    return { id: 1 };
  });
  render(<ImportAccount />);
  fireEvent.click(screen.getByRole('checkbox'));
  const publicInput = screen.getByPlaceholderText(
    'settings.publicIdentifierInput'
  );
  fireEvent.change(publicInput, { target: { value: PUBLIC_ADDRESS } });
  await waitFor(() =>
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'validateWatchOnlyIdentifier'],
      [PUBLIC_ADDRESS]
    )
  );
  fireEvent.change(publicInput, { target: { value: 'invalid-current-value' } });
  await act(async () => old.resolve(true));
  expect(importButton().hasAttribute('disabled')).toBe(true);
  await act(async () => submitForm());
  expect(
    mockEmitter.mock.calls.every(
      ([method]) => method[1] === 'validateWatchOnlyIdentifier'
    )
  ).toBe(true);
});
