/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import { Receive } from './Receive';

const mockWrite = jest.fn();
const mockSuccess = jest.fn();
const mockError = jest.fn();
const mockDismiss = jest.fn();
let mockState: any;
const mockValidate = jest.fn();
let clock = 2_000_000_000_000;
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (methods: string[], params: unknown[]) =>
    mockValidate(methods, params),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: () => 'transactions.copyFailed' },
}));
jest.mock('react-toastify', () => ({
  toast: Object.assign(jest.fn(), {
    success: (...args: any[]) => mockSuccess(...args),
    error: (...args: any[]) => mockError(...args),
    dismiss: (...args: any[]) => mockDismiss(...args),
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: jest.requireActual('../../hooks/useUtils').useUtils,
}));
jest.mock('../../hooks/useSafeNavigate', () => ({
  useSafeNavigate: () => jest.requireActual('react-router-dom').useNavigate(),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('../../components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => null }));

const records = {
  HDAccount: {
    id: 0,
    address: 'tsys1q6rz28mcfaxtmd6v789l9rrlrusdprr9p4ugvp5',
    xpub: 'public-xpub',
  },
  Imported: {
    id: 1,
    address: '0x1111111111111111111111111111111111111111',
    isImported: true,
    isReadOnly: true,
  },
  SmartAccount: {
    id: 2,
    address: '0x2222222222222222222222222222222222222222',
    isSmartAccount: true,
  },
};
const select = (
  type: keyof typeof records,
  address = records[type].address
) => {
  const record = { ...records[type], address };
  mockState = {
    vault: {
      accounts: { [type]: { [record.id]: record } },
      activeAccount: { id: record.id, type },
      activeNetwork: {
        kind: type === 'HDAccount' ? 'syscoin' : 'ethereum',
        chainId: type === 'HDAccount' ? 5700 : 1,
        slip44: type === 'HDAccount' ? 1 : 60,
        label: type === 'HDAccount' ? 'Syscoin Testnet' : 'Ethereum Testnet',
        url: 'https://synthetic.invalid/',
        apiUrl: 'https://synthetic.invalid/api',
      },
    },
    vaultGlobal: { activeSlip44: type === 'HDAccount' ? 1 : 60 },
  };
};
const Shell = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/home')}>Back to Home</button>
      <Routes>
        <Route
          path="/home"
          element={
            <button onClick={() => navigate('/receive')}>Open Receive</button>
          }
        />
        <Route path="/receive" element={<Receive />} />
      </Routes>
    </>
  );
};
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/home']}>
      <Shell />
    </MemoryRouter>
  );
const enter = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Open Receive' }));
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};
const qrPath = (address: string) => {
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<QRCodeSVG value={address} />);
  return Array.from(element.querySelectorAll('path')).map((path) =>
    path.getAttribute('d')
  );
};
const visibleQr = () =>
  Array.from(document.querySelectorAll('#qr-code path')).map((path) =>
    path.getAttribute('d')
  );
const pending = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((pass, fail) => {
    resolve = pass;
    reject = fail;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  jest.useFakeTimers();
  clock += 60_000;
  jest.setSystemTime(clock);
  jest.clearAllMocks();
  mockWrite.mockReset().mockResolvedValue(undefined);
  mockValidate.mockReset().mockImplementation((methods, [address, chainId]) => {
    expect(methods).toEqual(['wallet', 'validateSysAddress']);
    expect(chainId).toBe(5700);
    const bitcoin = jest.requireActual('bitcoinjs-lib');
    try {
      // Only the controller transport is replaced. Its public test response
      // uses the real decoder with the Syscoin Testnet encoding.
      bitcoin.address.toOutputScript(address, {
        ...bitcoin.networks.testnet,
        bech32: 'tsys',
        pubKeyHash: 65,
      });
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWrite },
  });
  select('HDAccount');
});
afterEach(() => jest.useRealTimers());

it.each([
  ['HDAccount', 'receive.hdAccount', 'Syscoin Testnet'],
  ['Imported', 'components.imported', 'Ethereum Testnet'],
  ['SmartAccount', 'receive.smartAccount', 'Ethereum Testnet'],
] as const)(
  'shows and copies the same public address for %s',
  async (type, label, network) => {
    select(type);
    mount();
    enter();
    await settle();
    const address = records[type].address;
    expect(screen.getByText(address)).toBeDefined();
    expect(screen.getByText(label)).toBeDefined();
    expect(screen.getByText(network)).toBeDefined();
    expect(visibleQr()).toEqual(qrPath(address));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    expect(mockWrite).toHaveBeenCalledWith(address);
    await settle();
    expect(mockSuccess).toHaveBeenCalledWith('home.addressCopied', undefined);
    expect(mockError).not.toHaveBeenCalled();
  }
);

it.each(['{Enter}', ' '])(
  'copies through native keyboard %s activation',
  async (key) => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mockWrite },
    });
    mount();
    enter();
    await settle();
    screen.getByRole('button', { name: 'buttons.copy' }).focus();
    await user.keyboard(key);
    await settle();
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith(records.HDAccount.address);
  }
);

it('shows a real clipboard rejection without a copied success notice', async () => {
  mockWrite.mockRejectedValueOnce(new Error('Synthetic denied clipboard'));
  mount();
  enter();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
  await settle();
  expect(mockError).toHaveBeenCalledWith('transactions.copyFailed');
  expect(mockSuccess).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'retires copy feedback after leaving Receive before %s',
  async (outcome) => {
    const held = pending();
    mockWrite.mockReturnValueOnce(held.promise);
    mount();
    enter();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(document.querySelector('#qr-code')).toBeNull();
    await act(async () => {
      if (outcome === 'resolve') held.resolve();
      else held.reject(new Error('Synthetic late rejection'));
    });
    await settle();
    expect(mockSuccess).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  }
);

it('waits for a missing public address then recovers and copies the actual address', async () => {
  select('HDAccount', '');
  const view = mount();
  enter();
  expect(screen.queryByRole('button', { name: 'buttons.copy' })).toBeNull();
  await act(async () => jest.advanceTimersByTimeAsync(8000));
  expect(screen.getByText('receive.addressUnavailable')).toBeDefined();
  expect(document.querySelector('#qr-code')).toBeNull();
  select('HDAccount');
  view.rerender(
    <MemoryRouter initialEntries={['/home']}>
      <Shell />
    </MemoryRouter>
  );
  await settle();
  expect(screen.getByText(records.HDAccount.address)).toBeDefined();
  expect(visibleQr()).toEqual(qrPath(records.HDAccount.address));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
  await settle();
  expect(mockWrite).toHaveBeenCalledWith(records.HDAccount.address);
});

const descriptor =
  'wpkh(tpubDC3pD7UZXnsgh3EBjbtBQiB1FnLask7UHBSunZ1DPK4dCFFZoFRkgxHB8gt42FvLzx1DpxfHWxAsYaY6b643RVcGjDxXxns7wKKYnnfEcbB)';
const validation = () => {
  let resolve!: (valid: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const redraw = (view: ReturnType<typeof mount>) =>
  view.rerender(
    <MemoryRouter initialEntries={['/home']}>
      <Shell />
    </MemoryRouter>
  );

it('never exposes an old raw descriptor as address text, QR or copy target', async () => {
  select('HDAccount', descriptor);
  mockState.vault.activeAccount.type = 'Imported';
  mockState.vault.accounts = {
    Imported: {
      0: {
        ...records.HDAccount,
        address: descriptor,
        xpub: descriptor,
        isImported: true,
      },
    },
  };
  mount();
  enter();
  expect(document.querySelector('#qr-code')).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.copy' })).toBeNull();
  await settle();
  expect(screen.getByText('receive.addressUnavailable')).toBeDefined();
  expect(screen.queryByText(descriptor)).toBeNull();
  expect(mockWrite).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }));
  expect(screen.getByRole('button', { name: 'Open Receive' })).toBeDefined();
});

it('keeps the address hidden until its current network validation completes', async () => {
  const held = validation();
  mockValidate.mockReturnValueOnce(held.promise);
  mount();
  enter();
  expect(document.querySelector('#qr-code')).toBeNull();
  await act(async () => held.resolve(true));
  expect(screen.getByText(records.HDAccount.address)).toBeDefined();
  expect(visibleQr()).toEqual(qrPath(records.HDAccount.address));
});

it('shows a canonical UTXO watch-only address while retaining its descriptor reference', async () => {
  const address = 'tsys1qalwlmdxd2ggue4290ekzxl9tetg56neeepgwhk';
  select('HDAccount', address);
  mockState.vault.activeAccount.type = 'Imported';
  mockState.vault.accounts = {
    Imported: {
      0: { ...records.HDAccount, address, xpub: descriptor, isImported: true },
    },
  };
  mount();
  enter();
  await settle();
  expect(screen.getByText(address)).toBeDefined();
  expect(visibleQr()).toEqual(qrPath(address));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.copy' }));
  await settle();
  expect(mockWrite).toHaveBeenCalledWith(address);
  expect(mockState.vault.accounts.Imported[0].xpub).toBe(descriptor);
});

it('rejects a stale network result even when the public address is unchanged', async () => {
  const held = validation();
  mockValidate.mockReturnValueOnce(held.promise);
  const view = mount();
  enter();
  mockValidate.mockResolvedValueOnce(false);
  mockState.vault.activeNetwork.url = 'https://other-synthetic.invalid/';
  redraw(view);
  await settle();
  expect(screen.getByText('receive.addressUnavailable')).toBeDefined();
  await act(async () => held.resolve(true));
  expect(document.querySelector('#qr-code')).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.copy' })).toBeNull();
});

it('does not let an old successful validation reveal a newly selected raw descriptor', async () => {
  const held = validation();
  mockValidate.mockReturnValueOnce(held.promise);
  const view = mount();
  enter();
  select('HDAccount', descriptor);
  redraw(view);
  await settle();
  expect(screen.getByText('receive.addressUnavailable')).toBeDefined();
  await act(async () => held.resolve(true));
  expect(document.querySelector('#qr-code')).toBeNull();
  expect(screen.queryByRole('button', { name: 'buttons.copy' })).toBeNull();
});

it('does not let an old refusal hide the newly validated account', async () => {
  select('HDAccount', descriptor);
  const held = validation();
  mockValidate.mockReturnValueOnce(held.promise);
  const view = mount();
  enter();
  select('Imported');
  redraw(view);
  await settle();
  expect(screen.getByText(records.Imported.address)).toBeDefined();
  await act(async () => held.resolve(false));
  expect(screen.getByText(records.Imported.address)).toBeDefined();
  expect(visibleQr()).toEqual(qrPath(records.Imported.address));
});

it('fails closed when background address validation rejects', async () => {
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    mockValidate.mockRejectedValueOnce(
      new Error('Synthetic validation refusal')
    );
    mount();
    enter();
    await settle();
    expect(screen.getByText('receive.addressUnavailable')).toBeDefined();
    expect(document.querySelector('#qr-code')).toBeNull();
    expect(mockWrite).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});

it('times out unfinished validation and ignores it after leaving Receive', async () => {
  const held = validation();
  mockValidate.mockReturnValueOnce(held.promise);
  mount();
  enter();
  await act(async () => jest.advanceTimersByTimeAsync(8000));
  expect(screen.getByText('receive.addressUnavailable')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'receive.retry' }));
  await act(async () => held.resolve(true));
  expect(screen.getByRole('button', { name: 'Open Receive' })).toBeDefined();
  expect(document.querySelector('#qr-code')).toBeNull();
});
