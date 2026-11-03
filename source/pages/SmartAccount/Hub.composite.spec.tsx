/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

import { KeyringAccountType } from 'types/network';

import SmartAccountHub from './Hub';

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const mockEmitter = jest.fn();
const mockSubmit = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
let mockState: any;
let mockGeneration = 7;
let mockUnlocked = true;
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/home/smart-account',
    search: '',
    hash: '',
    key: 'hub',
  }),
}));

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: mockUnlocked,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) =>
    state.vault.accounts[state.vault.activeAccount.type][
      state.vault.activeAccount.id
    ],
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: `${mockState.vault.activeAccount.type}:${
      mockState.vault.activeAccount.id
    }:${
      mockState.vault.accounts[mockState.vault.activeAccount.type][
        mockState.vault.activeAccount.id
      ].address
    }`,
    network: JSON.stringify(mockState.vault.activeNetwork),
  }),
}));
jest.mock('./SmartAccountEntry', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('antd', () => {
  const Form: any = ({ children }: any) => <form>{children}</form>;
  Form.displayName = 'MockForm';
  Form.Item = function MockFormItem({ children, label, htmlFor }: any) {
    return (
      <div>
        {label && <label htmlFor={htmlFor}>{label}</label>}
        {children}
      </div>
    );
  };
  return { Form, Input: (props: any) => <input {...props} /> };
});
jest.mock('components/index', () => ({
  AddressText: ({ value }: any) => <span>{value}</span>,
  Button: ({ children, loading, variant, size, ...props }: any) => (
    <button
      {...props}
      data-variant={variant}
      data-size={size}
      disabled={Boolean(props.disabled || loading)}
    >
      {children}
    </button>
  ),
  CenterPanel: ({ children }: any) => <div>{children}</div>,
  CenterTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogHeader: ({ title, onClose, disabled }: any) => (
    <header>
      <h2>{title}</h2>
      <button type="button" disabled={disabled} onClick={onClose}>
        dialog close
      </button>
    </header>
  ),
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogActions: ({ children }: any) => <div>{children}</div>,
  DialogActionButton: ({ children, loading, tone, ...props }: any) => (
    <button
      {...props}
      data-tone={tone}
      disabled={Boolean(props.disabled || loading)}
    >
      {children}
    </button>
  ),
  ConfirmationModal: ({ show, onClick }: any) =>
    show ? (
      <button type="button" onClick={onClick}>
        confirm-uninstall
      </button>
    ) : null,
  DialogPrimitive: ({ children, show = true }: any) =>
    show ? <div role="dialog">{children}</div> : null,
  Icon: () => null,
}));
// Keep this suite about the Hub lifecycle, independently of the visual dialog.
// Its Save callback remains invocable to test defensive validation as well.
jest.mock('./CompositeApprovalDialog', () => ({
  __esModule: true,
  default: ({ candidates, value, saving, onChange, onClose, onSave }: any) => (
    <div role="dialog">
      {candidates.map((candidate: any) => (
        <label key={candidate.address}>
          <input
            type="checkbox"
            disabled={saving}
            checked={value.children.includes(candidate.address)}
            onChange={() =>
              onChange({
                ...value,
                children: value.children.includes(candidate.address)
                  ? value.children.filter(
                      (child: string) => child !== candidate.address
                    )
                  : [...value.children, candidate.address],
              })
            }
          />
          {candidate.address}
        </label>
      ))}
      <label>
        smartAccountHub.threshold
        <input
          type="number"
          disabled={saving}
          value={value.threshold}
          onChange={(event) =>
            onChange({ ...value, threshold: Number(event.target.value) })
          }
        />
      </label>
      <button type="button" disabled={saving} onClick={onClose}>
        buttons.cancel
      </button>
      <button type="button" disabled={saving} onClick={onSave}>
        buttons.save
      </button>
    </div>
  ),
}));
jest.mock('utils/smartAccount', () => {
  const actual = jest.requireActual('utils/smartAccount/account');
  return {
    encodeCompositeValidatorInitData: actual.encodeCompositeValidatorInitData,
    encodeInstallValidatorModuleCall: actual.encodeInstallValidatorModuleCall,
    encodeRotateValidatorModuleCall: actual.encodeRotateValidatorModuleCall,
    encodeUninstallValidatorModuleCall:
      actual.encodeUninstallValidatorModuleCall,
    getAvailablePaliModules: () => [{ id: 'composite', supported: true }],
    getPaliModuleAddress: () => address(3),
    getSmartAccountLocalOwnerContexts: () => ({}),
    isPaliSignableValidator: (module: any) => module.id !== 'custom',
    listCompositeChildCandidates: (metadata: any) =>
      metadata.installedModules.filter(
        (module: any) => module.id !== 'composite'
      ),
    signAndSubmitSmartAccountExecutions: (...args: any[]) =>
      mockSubmit(...args),
  };
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const metadata = (offset = 0) => ({
  chainId: 57057,
  isDeployed: true,
  auth: { module: 'composite', validator: address(3 + offset), data: '0x' },
  installedModules: [
    {
      type: 'validator',
      id: 'ecdsa',
      address: address(1 + offset),
      data: '0x',
      config: { owners: [address(80)], threshold: 1 },
    },
    {
      type: 'validator',
      id: 'slh-dsa',
      address: address(2 + offset),
      data: '0x',
      config: { keyId: 'qa' },
    },
    {
      type: 'validator',
      id: 'composite',
      address: address(3 + offset),
      data: '0x',
      config: {
        childValidators: [address(1 + offset), address(2 + offset)],
        threshold: 2,
      },
    },
  ],
});
const account = (id: number) => ({
  id,
  address: address(100 + id),
  isSmartAccount: true,
  smartAccount: metadata(id * 10),
});
const select = (id: number) => {
  mockState.vault.activeAccount = { id, type: KeyringAccountType.SmartAccount };
};
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'smartAccountHub.edit' }));
  return screen.findByRole('dialog');
};
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));

beforeEach(() => {
  window.history.replaceState({}, '', '/#/home/smart-account');
  jest.clearAllMocks();
  mockGeneration = 7;
  mockUnlocked = true;
  mockState = {
    vault: {
      accounts: {
        [KeyringAccountType.SmartAccount]: { 0: account(0), 1: account(1) },
      },
      activeAccount: { id: 0, type: KeyringAccountType.SmartAccount },
      activeNetwork: {
        chainId: 57057,
        url: 'https://qa.invalid/rpc',
        kind: 'ethereum',
      },
    },
    vaultGlobal: { activeSlip44: 60 },
  };
  mockEmitter.mockImplementation(async (methods: string[], params?: any[]) => {
    if (methods[1] === 'getWalletSessionGeneration') return mockGeneration;
    if (methods[1] === 'hydrateSmartAccount')
      return mockState.vault.accounts[KeyringAccountType.SmartAccount][
        params![0]
      ].smartAccount;
    return undefined;
  });
  mockSubmit.mockResolvedValue({ hash: '0xack' });
});

it('submits a valid two-child policy once and closes after acknowledgement', async () => {
  render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mockAlert.success).toHaveBeenCalledWith(
    'smartAccountHub.compositeSaved'
  );
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('keeps the current account metadata when an older hydration finishes last', async () => {
  const oldRead = deferred<any>();
  mockEmitter.mockImplementation(async (methods, params) =>
    methods[1] === 'getWalletSessionGeneration'
      ? mockGeneration
      : params?.[0] === 0
      ? oldRead.promise
      : metadata(10)
  );
  const view = render(<SmartAccountHub />);
  select(1);
  view.rerender(<SmartAccountHub />);
  await waitFor(() =>
    expect(screen.getAllByText(address(13)).length).toBeGreaterThan(0)
  );
  await act(async () => oldRead.resolve(metadata()));
  await open();
  expect(within(screen.getByRole('dialog')).queryByText(address(1))).toBeNull();
  expect(
    within(screen.getByRole('dialog')).getByText(address(11))
  ).toBeDefined();
});

it.each(['account', 'rpc', 'chain', 'lock'])(
  'closes an open composite draft on %s change',
  async (kind) => {
    const view = render(<SmartAccountHub />);
    await open();
    if (kind === 'account') select(1);
    if (kind === 'rpc')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://other.invalid',
      };
    if (kind === 'chain')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        chainId: 1,
      };
    if (kind === 'lock') mockUnlocked = false;
    view.rerender(<SmartAccountHub />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockSubmit).not.toHaveBeenCalled();
  }
);

it('tracks the saved execution within the modal-opening wallet generation and account', async () => {
  render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  expect(mockSubmit.mock.calls[0][0].expectedContext).toEqual({
    account: {
      id: 0,
      type: KeyringAccountType.SmartAccount,
      address: address(100),
    },
    chainId: 57057,
    rpcUrl: 'https://qa.invalid/rpc',
    slip44: 60,
    sessionGeneration: 7,
  });
  expect(mockSubmit.mock.calls[0][0].trackLocalSubmission).toBe(true);
});

it('refuses a changed generation before signing even when visible account and network are unchanged', async () => {
  render(<SmartAccountHub />);
  await open();
  mockGeneration += 1;
  save();
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('ignores an opening generation read that settles after the user switches account', async () => {
  const generation = deferred<number>();
  mockEmitter.mockImplementation(async (methods, params) =>
    methods[1] === 'getWalletSessionGeneration'
      ? generation.promise
      : mockState.vault.accounts[KeyringAccountType.SmartAccount][params[0]]
          .smartAccount
  );
  const view = render(<SmartAccountHub />);
  fireEvent.click(screen.getByRole('button', { name: 'smartAccountHub.edit' }));
  select(1);
  view.rerender(<SmartAccountHub />);
  await act(async () => generation.resolve(7));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('rejects a fractional threshold with a handled validation error', async () => {
  render(<SmartAccountHub />);
  await open();
  fireEvent.change(screen.getByRole('spinbutton'), {
    target: { value: '1.5' },
  });
  save();
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'smartAccountHub.compositeInvalid'
    )
  );
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('rejects duplicate child addresses rather than counting one signer twice', async () => {
  const duplicate = metadata();
  duplicate.installedModules[2].config = {
    childValidators: [address(1), address(1)],
    threshold: 1,
  } as any;
  mockState.vault.accounts[KeyringAccountType.SmartAccount][0].smartAccount =
    duplicate;
  render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('freezes editing and Cancel until the submitted operation settles', async () => {
  const pending = deferred<any>();
  mockSubmit.mockReturnValue(pending.promise);
  render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  for (const checkbox of screen.getAllByRole('checkbox'))
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('spinbutton') as HTMLInputElement).disabled).toBe(
    true
  );
  expect(
    (
      screen.getByRole('button', {
        name: 'buttons.cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => pending.resolve({ hash: '0xack' }));
});

it('blocks signing when account changes during preparation', async () => {
  const prepared = deferred<void>();
  const sign = jest.fn();
  mockSubmit.mockImplementation(async (params) => {
    await prepared.promise;
    params.onPrepared?.();
    sign();
    return { hash: '0xack' };
  });
  const view = render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  select(1);
  view.rerender(<SmartAccountHub />);
  await act(async () => prepared.resolve());
  expect(sign).not.toHaveBeenCalled();
});

it('blocks signing after native route departure before React unmounts', async () => {
  const prepared = deferred<void>();
  const sign = jest.fn();
  mockSubmit.mockImplementation(async (params) => {
    await prepared.promise;
    params.onPrepared?.();
    sign();
    return { hash: '0xack' };
  });
  render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  window.history.replaceState({}, '', '/#/home');
  await act(async () => prepared.resolve());
  expect(sign).not.toHaveBeenCalled();
});

it('does not open a delayed modal after native navigation away', async () => {
  const generation = deferred<number>();
  mockEmitter.mockImplementation(async (methods, params) =>
    methods[1] === 'getWalletSessionGeneration'
      ? generation.promise
      : mockState.vault.accounts[KeyringAccountType.SmartAccount][params[0]]
          .smartAccount
  );
  render(<SmartAccountHub />);
  fireEvent.click(screen.getByRole('button', { name: 'smartAccountHub.edit' }));
  window.history.replaceState({}, '', '/#/home');
  await act(async () => generation.resolve(7));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('preserves an acknowledgement after a switch without refreshing or closing a new draft', async () => {
  const pending = deferred<any>();
  mockSubmit.mockReturnValueOnce(pending.promise);
  const view = render(<SmartAccountHub />);
  await open();
  save();
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  select(1);
  view.rerender(<SmartAccountHub />);
  await open();
  const reads = mockEmitter.mock.calls.filter(
    ([methods]) => methods[1] === 'hydrateSmartAccount'
  ).length;
  await act(async () => pending.resolve({ hash: '0xack' }));
  expect(screen.getByRole('dialog')).toBeDefined();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'hydrateSmartAccount'
    )
  ).toHaveLength(reads);
});

it('does not hydrate an old account when another Hub action finishes after a switch', async () => {
  const pending = deferred<any>();
  const extra = {
    type: 'validator',
    id: 'ecdsa',
    address: address(4),
    data: '0x',
    config: { owners: [address(80)], threshold: 1 },
  };
  mockState.vault.accounts[
    KeyringAccountType.SmartAccount
  ][0].smartAccount.installedModules.push(extra);
  mockSubmit.mockReturnValue(pending.promise);
  const view = render(<SmartAccountHub />);
  const uninstall = screen
    .getAllByRole('button', { name: 'smartAccountHub.uninstall' })
    .find((button) => !(button as HTMLButtonElement).disabled)!;
  fireEvent.click(uninstall);
  fireEvent.click(
    await screen.findByRole('button', { name: 'confirm-uninstall' })
  );
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
  select(1);
  view.rerender(<SmartAccountHub />);
  await waitFor(() =>
    expect(screen.getAllByText(address(13)).length).toBeGreaterThan(0)
  );
  const reads = mockEmitter.mock.calls.filter(
    ([methods]) => methods[1] === 'hydrateSmartAccount'
  ).length;
  await act(async () => pending.resolve({ hash: '0xack' }));
  expect(
    mockEmitter.mock.calls.filter(
      ([methods]) => methods[1] === 'hydrateSmartAccount'
    )
  ).toHaveLength(reads);
  expect(screen.getAllByText(address(13)).length).toBeGreaterThan(0);
});

describe('custom-validator dialog', () => {
  const openCustom = async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'smartAccountHub.install' })
    );
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText('0x...'), {
      target: { value: address(90) },
    });
  };
  const check = async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'smartAccountHub.checkModule' })
    );
    await screen.findByText('smartAccountHub.preflightPassed');
  };
  const acknowledge = () => fireEvent.click(screen.getByRole('checkbox'));
  const install = () =>
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'smartAccountHub.install',
      })
    );
  beforeEach(() => {
    select(1);
    mockEmitter.mockImplementation(async (methods, params) => {
      if (methods[1] === 'getWalletSessionGeneration') return mockGeneration;
      if (methods[1] === 'hydrateSmartAccount')
        return mockState.vault.accounts[KeyringAccountType.SmartAccount][
          params[0]
        ].smartAccount;
      if (methods[1] === 'preflightSmartAccountCustomValidator')
        return { ok: true, compositeCompatible: true, failures: [] };
      return undefined;
    });
  });

  it('preserves the preflight, explicit acknowledgement and two-execution install flow', async () => {
    render(<SmartAccountHub />);
    await openCustom();
    await check();
    install();
    expect(mockSubmit).not.toHaveBeenCalled();
    acknowledge();
    install();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0].executions).toHaveLength(2);
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([methods]) => methods[1] === 'addSmartAccountCustomModule'
        )
      ).toBe(true)
    );
  });

  it('allows the first smart account id zero to run preflight', async () => {
    select(0);
    render(<SmartAccountHub />);
    await openCustom();
    await check();
    expect(
      mockEmitter.mock.calls.find(
        ([methods]) => methods[1] === 'preflightSmartAccountCustomValidator'
      )?.[1]
    ).toEqual([{ accountId: 0, address: address(90) }]);
  });

  it('labels each field and freezes form and dismissal while preflight runs', async () => {
    const pending = deferred<any>();
    mockEmitter.mockImplementation(async (methods, params) =>
      methods[1] === 'getWalletSessionGeneration'
        ? mockGeneration
        : methods[1] === 'hydrateSmartAccount'
        ? mockState.vault.accounts[KeyringAccountType.SmartAccount][params[0]]
            .smartAccount
        : pending.promise
    );
    render(<SmartAccountHub />);
    await openCustom();
    fireEvent.click(
      screen.getByRole('button', { name: 'smartAccountHub.checkModule' })
    );
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([methods]) => methods[1] === 'preflightSmartAccountCustomValidator'
        )
      ).toBe(true)
    );
    expect(
      (
        screen.getByRole('textbox', {
          name: 'smartAccountHub.moduleAddress',
        }) as HTMLInputElement
      ).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.cancel',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () =>
      pending.resolve({ ok: true, compositeCompatible: true, failures: [] })
    );
  });

  it.each(['account', 'rpc'])(
    'closes the custom draft on %s change',
    async (kind) => {
      const view = render(<SmartAccountHub />);
      await openCustom();
      if (kind === 'account') select(0);
      else
        mockState.vault.activeNetwork = {
          ...mockState.vault.activeNetwork,
          url: 'https://other.invalid',
        };
      view.rerender(<SmartAccountHub />);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  );

  it('does not put an old preflight result into a newly opened custom draft', async () => {
    const pending = deferred<any>();
    let slow = true;
    mockEmitter.mockImplementation(async (methods, params) =>
      methods[1] === 'getWalletSessionGeneration'
        ? mockGeneration
        : methods[1] === 'hydrateSmartAccount'
        ? mockState.vault.accounts[KeyringAccountType.SmartAccount][params[0]]
            .smartAccount
        : slow
        ? pending.promise
        : { ok: true, compositeCompatible: true, failures: [] }
    );
    const view = render(<SmartAccountHub />);
    await openCustom();
    fireEvent.click(
      screen.getByRole('button', { name: 'smartAccountHub.checkModule' })
    );
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(
          ([methods]) => methods[1] === 'preflightSmartAccountCustomValidator'
        )
      ).toBe(true)
    );
    select(0);
    view.rerender(<SmartAccountHub />);
    slow = false;
    await openCustom();
    await act(async () =>
      pending.resolve({ ok: true, compositeCompatible: true, failures: [] })
    );
    expect(screen.queryByText('smartAccountHub.preflightPassed')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'smartAccountHub.checkModule' })
    ).toBeDefined();
  });

  it('tracks custom installation within the opening wallet generation', async () => {
    render(<SmartAccountHub />);
    await openCustom();
    await check();
    acknowledge();
    install();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0].expectedContext?.sessionGeneration).toBe(
      7
    );
    expect(mockSubmit.mock.calls[0][0].trackLocalSubmission).toBe(true);
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.find(
          ([methods]) => methods[1] === 'addSmartAccountCustomModule'
        )?.[1][0].expectedContext
      ).toEqual(mockSubmit.mock.calls[0][0].expectedContext)
    );
  });

  it('keeps an acknowledged install out of the replacement account and new draft', async () => {
    const pending = deferred<any>();
    mockSubmit.mockReturnValue(pending.promise);
    const view = render(<SmartAccountHub />);
    await openCustom();
    await check();
    acknowledge();
    install();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    select(0);
    view.rerender(<SmartAccountHub />);
    await openCustom();
    await act(async () => pending.resolve({ hash: '0xack' }));
    expect(
      mockEmitter.mock.calls.some(
        ([methods]) => methods[1] === 'addSmartAccountCustomModule'
      )
    ).toBe(false);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(mockAlert.error).not.toHaveBeenCalled();
  });

  it('does not offer an acknowledged install again if saving local metadata fails', async () => {
    mockEmitter.mockImplementation(async (methods, params) => {
      if (methods[1] === 'getWalletSessionGeneration') return mockGeneration;
      if (methods[1] === 'hydrateSmartAccount')
        return mockState.vault.accounts[KeyringAccountType.SmartAccount][
          params[0]
        ].smartAccount;
      if (methods[1] === 'preflightSmartAccountCustomValidator')
        return { ok: true, compositeCompatible: true, failures: [] };
      if (methods[1] === 'addSmartAccountCustomModule')
        throw new Error('Local storage unavailable');
      return undefined;
    });
    render(<SmartAccountHub />);
    await openCustom();
    await check();
    acknowledge();
    install();
    await waitFor(() =>
      expect(mockAlert.success).toHaveBeenCalledWith(
        'smartAccountHub.moduleInstalled'
      )
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockAlert.error).not.toHaveBeenCalledWith('send.cantCompleteTxs');
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('closes only the accepted draft when the wallet generation changes after acknowledgement', async () => {
    const pending = deferred<any>();
    mockSubmit.mockReturnValue(pending.promise);
    render(<SmartAccountHub />);
    await openCustom();
    await check();
    acknowledge();
    install();
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    mockGeneration++;
    await act(async () => pending.resolve({ hash: '0xack' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockAlert.success).toHaveBeenCalledWith(
      'smartAccountHub.moduleInstalled'
    );
    expect(
      mockEmitter.mock.calls.some(
        ([methods]) => methods[1] === 'addSmartAccountCustomModule'
      )
    ).toBe(false);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('uninstall approval scope', () => {
  beforeEach(() => {
    select(1);
    mockState.vault.accounts[
      KeyringAccountType.SmartAccount
    ][1].smartAccount.installedModules.push({
      id: 'custom',
      type: 'validator',
      address: address(90),
      data: '0x',
      config: { name: 'Custom' },
    });
    mockEmitter.mockImplementation(async (methods, params) =>
      methods[1] === 'getWalletSessionGeneration'
        ? mockGeneration
        : methods[1] === 'hydrateSmartAccount'
        ? mockState.vault.accounts[KeyringAccountType.SmartAccount][params[0]]
            .smartAccount
        : undefined
    );
  });
  const openUninstall = async () => {
    const action = screen
      .getAllByRole('button', { name: 'smartAccountHub.uninstall' })
      .find((button) => !(button as HTMLButtonElement).disabled)!;
    fireEvent.click(action);
    await screen.findByRole('button', { name: 'confirm-uninstall' });
  };

  it.each(['account', 'rpc'])(
    'discards an uninstall approval when %s changes',
    async (axis) => {
      const view = render(<SmartAccountHub />);
      await openUninstall();
      if (axis === 'account') select(0);
      else mockState.vault.activeNetwork.url = 'https://replacement.invalid';
      view.rerender(<SmartAccountHub />);
      expect(
        screen.queryByRole('button', { name: 'confirm-uninstall' })
      ).toBeNull();
    }
  );

  it('tracks uninstall and binds local removal to the opening session', async () => {
    render(<SmartAccountHub />);
    await openUninstall();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-uninstall' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    expect(mockSubmit.mock.calls[0][0].expectedContext?.sessionGeneration).toBe(
      7
    );
    expect(mockSubmit.mock.calls[0][0].trackLocalSubmission).toBe(true);
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.find(
          ([methods]) => methods[1] === 'removeSmartAccountCustomModule'
        )?.[1][0].expectedContext
      ).toEqual(mockSubmit.mock.calls[0][0].expectedContext)
    );
  });

  it('ignores an uninstall acknowledgement after switching accounts', async () => {
    const pending = deferred<any>();
    mockSubmit.mockReturnValue(pending.promise);
    const view = render(<SmartAccountHub />);
    await openUninstall();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-uninstall' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    select(0);
    view.rerender(<SmartAccountHub />);
    await act(async () => pending.resolve({ hash: '0xack' }));
    expect(
      mockEmitter.mock.calls.some(
        ([methods]) => methods[1] === 'removeSmartAccountCustomModule'
      )
    ).toBe(false);
    expect(mockAlert.error).not.toHaveBeenCalled();
  });

  it('does not sign an uninstall after its opening wallet generation changes', async () => {
    render(<SmartAccountHub />);
    await openUninstall();
    mockGeneration++;
    fireEvent.click(screen.getByRole('button', { name: 'confirm-uninstall' }));
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalled());
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('closes an accepted uninstall after a same-account session change without writing metadata', async () => {
    const pending = deferred<any>();
    mockSubmit.mockReturnValue(pending.promise);
    render(<SmartAccountHub />);
    await openUninstall();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-uninstall' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
    mockGeneration++;
    await act(async () => pending.resolve({ hash: '0xack' }));
    expect(
      screen.queryByRole('button', { name: 'confirm-uninstall' })
    ).toBeNull();
    expect(mockAlert.success).toHaveBeenCalledWith(
      'smartAccountHub.moduleUninstalled'
    );
    expect(
      mockEmitter.mock.calls.some(
        ([methods]) => methods[1] === 'removeSmartAccountCustomModule'
      )
    ).toBe(false);
  });

  it('does not offer an accepted uninstall again after local metadata fails', async () => {
    mockEmitter.mockImplementation(async (methods, params) => {
      if (methods[1] === 'getWalletSessionGeneration') return mockGeneration;
      if (methods[1] === 'hydrateSmartAccount')
        return mockState.vault.accounts[KeyringAccountType.SmartAccount][
          params[0]
        ].smartAccount;
      if (methods[1] === 'removeSmartAccountCustomModule')
        throw new Error('Local storage unavailable');
      return undefined;
    });
    render(<SmartAccountHub />);
    await openUninstall();
    fireEvent.click(screen.getByRole('button', { name: 'confirm-uninstall' }));
    await waitFor(() =>
      expect(mockAlert.success).toHaveBeenCalledWith(
        'smartAccountHub.moduleUninstalled'
      )
    );
    expect(
      screen.queryByRole('button', { name: 'confirm-uninstall' })
    ).toBeNull();
    expect(mockAlert.error).toHaveBeenCalledWith(
      'smartAccountHub.moduleMetadataRemoveFailed'
    );
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('initial smart-account deployment refresh', () => {
  const markCachedUndeployed = () => {
    const current =
      mockState.vault.accounts[KeyringAccountType.SmartAccount][0];
    current.smartAccount = {
      ...current.smartAccount,
      isDeployed: false,
      installedModules: [],
    };
  };

  it('refreshes an undeployed cache and shows an account deployed outside this document', async () => {
    markCachedUndeployed();
    const refresh = deferred<any>();
    mockEmitter.mockImplementation(async (methods) => {
      if (methods[1] === 'hydrateSmartAccount') return refresh.promise;
      if (methods[1] === 'getWalletSessionGeneration') return mockGeneration;
      return undefined;
    });
    render(<SmartAccountHub />);
    expect(screen.getByText('smartAccountHub.notDeployed')).toBeDefined();
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'hydrateSmartAccount'],
        [0],
        300000
      )
    );
    await act(async () => refresh.resolve(metadata()));
    expect(screen.queryByText('smartAccountHub.notDeployed')).toBeNull();
    expect(screen.getAllByText(address(3)).length).toBeGreaterThan(0);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('retains the conservative undeployed view when the refresh fails', async () => {
    markCachedUndeployed();
    mockEmitter.mockImplementation(async (methods) => {
      if (methods[1] === 'hydrateSmartAccount')
        throw new Error('Synthetic read unavailable');
      return undefined;
    });
    render(<SmartAccountHub />);
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'hydrateSmartAccount'],
        [0],
        300000
      )
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('smartAccountHub.notDeployed')).toBeDefined();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockAlert.error).not.toHaveBeenCalled();
  });

  it('does not apply a formerly undeployed account refresh after selecting another account', async () => {
    markCachedUndeployed();
    const oldRead = deferred<any>();
    mockEmitter.mockImplementation(async (methods, params) => {
      if (methods[1] === 'getWalletSessionGeneration') return mockGeneration;
      if (methods[1] === 'hydrateSmartAccount')
        return params[0] === 0 ? oldRead.promise : metadata(10);
      return undefined;
    });
    const view = render(<SmartAccountHub />);
    await waitFor(() =>
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'hydrateSmartAccount'],
        [0],
        300000
      )
    );
    select(1);
    view.rerender(<SmartAccountHub />);
    await waitFor(() =>
      expect(screen.getAllByText(address(13)).length).toBeGreaterThan(0)
    );
    await act(async () => oldRead.resolve(metadata(20)));
    expect(screen.queryByText(address(23))).toBeNull();
    expect(screen.getAllByText(address(13)).length).toBeGreaterThan(0);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each(['locked', 'ordinary account'])(
    'does not hydrate an inadmissible %s view',
    async (kind) => {
      markCachedUndeployed();
      if (kind === 'locked') mockUnlocked = false;
      else
        mockState.vault.accounts[
          KeyringAccountType.SmartAccount
        ][0].isSmartAccount = false;
      render(<SmartAccountHub />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        mockEmitter.mock.calls.filter(
          ([methods]) => methods[1] === 'hydrateSmartAccount'
        )
      ).toHaveLength(0);
      expect(mockSubmit).not.toHaveBeenCalled();
    }
  );
});
