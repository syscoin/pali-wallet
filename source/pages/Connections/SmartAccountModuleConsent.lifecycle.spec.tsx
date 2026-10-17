/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { SmartAccountModuleConsent } from './SmartAccountModuleConsent';

const address = (value: string) => `0x${value.repeat(40)}`;
const MODULE = address('3');
const mockEmitter = jest.fn();
const mockSubmit = jest.fn();
const mockT = (key: string) => key;
let mockState: any;
let mockQuery: any;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: (state: any) =>
    state.vault.accounts.SmartAccount[state.vault.activeAccount.id],
}));
jest.mock('components/index', () => ({
  AddressText: ({ value }: any) => <span>{value}</span>,
  Card: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
  Button: ({ children, onClick, disabled, loading }: any) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('utils/smartAccount', () => ({
  encodeInstallValidatorModuleCall: () => '0xinstall',
  encodeRotateValidatorModuleCall: () => '0xrotate',
  encodeUninstallValidatorModuleCall: () => '0xuninstall',
  getSmartAccountLocalOwnerContexts: () => ({}),
  signAndSubmitSmartAccountExecutions: (args: any) => mockSubmit(args),
}));
jest.mock('utils/smartAccountErrors', () => ({
  getSmartAccountActionErrorMessage: (error: Error) => error.message,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));

const metadata = (id: string) => ({
  address: address(id),
  chainId: 57057,
  isDeployed: true,
  auth: { validator: address('2'), module: 'ecdsa' },
  installedModules: [
    { address: address('2'), type: 'validator', id: 'ecdsa', data: '0xactive' },
    { address: MODULE, type: 'validator', id: 'custom', data: '0xmodule' },
  ],
});
const confirmation = () =>
  screen.getByRole('button', { name: 'buttons.confirm' }) as HTMLButtonElement;
const acknowledge = () => fireEvent.click(screen.getByRole('checkbox'));
const waitReady = async () =>
  screen.findByText('smartAccountHub.preflightPassed');

beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    dapp: { dapps: {} },
    vault: {
      activeAccount: { id: 0, type: 'SmartAccount' },
      activeNetwork: { chainId: 57057, url: 'https://rpc-a.invalid' },
      accounts: {
        SmartAccount: {
          0: {
            id: 0,
            address: address('1'),
            isSmartAccount: true,
            smartAccount: metadata('1'),
          },
          1: {
            id: 1,
            address: address('4'),
            isSmartAccount: true,
            smartAccount: metadata('4'),
          },
        },
      },
    },
  };
  mockQuery = {
    host: 'fixture.invalid',
    action: 'install',
    module: { address: MODULE },
  };
  mockEmitter.mockImplementation(async (method: string[], args: any[]) => {
    if (method[1] === 'hydrateSmartAccount')
      return metadata(args[0] === 0 ? '1' : '4');
    return { ok: true, failures: [], compositeCompatible: true };
  });
  mockSubmit.mockResolvedValue({ transactionHash: '0xfixture' });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('does not reuse a passed check and acknowledgment after an account change whose check fails', async () => {
  const view = render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  expect(confirmation().disabled).toBe(false);
  mockEmitter.mockRejectedValue(new Error('New account check failed'));
  mockState.vault.activeAccount = { id: 1, type: 'SmartAccount' };
  view.rerender(<SmartAccountModuleConsent />);
  await screen.findByText('New account check failed');
  expect(confirmation().disabled).toBe(true);
  expect(screen.queryByText('smartAccountHub.preflightPassed')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(mockSubmit).not.toHaveBeenCalled();
});

it('requires a fresh acknowledgment when the RPC changes on the same chain', async () => {
  const view = render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  expect(confirmation().disabled).toBe(false);
  const before = mockEmitter.mock.calls.length;
  mockState.vault.activeNetwork = {
    chainId: 57057,
    url: 'https://rpc-b.invalid',
  };
  view.rerender(<SmartAccountModuleConsent />);
  await waitFor(() =>
    expect(mockEmitter.mock.calls.length).toBeGreaterThan(before)
  );
  await waitReady();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
    false
  );
  expect(confirmation().disabled).toBe(true);
});

it('clears consent if init data changes even when the module address does not', async () => {
  const view = render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  mockQuery = { ...mockQuery, module: { address: MODULE, initData: '0x1234' } };
  view.rerender(<SmartAccountModuleConsent />);
  await waitReady();
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
    false
  );
  expect(confirmation().disabled).toBe(true);
});

it('keeps uninstall disabled if a replacement account cannot be hydrated', async () => {
  mockQuery = { ...mockQuery, action: 'uninstall' };
  const view = render(<SmartAccountModuleConsent />);
  await waitFor(() => expect(confirmation().disabled).toBe(false));
  mockEmitter.mockRejectedValue(new Error('Unavailable current metadata'));
  mockState.vault.activeAccount = { id: 1, type: 'SmartAccount' };
  view.rerender(<SmartAccountModuleConsent />);
  await screen.findByText('Unavailable current metadata');
  expect(confirmation().disabled).toBe(true);
});

it('owns approval synchronously so two same-frame activations do not sign twice', async () => {
  mockSubmit.mockReturnValue(new Promise(() => undefined));
  render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  const button = confirmation();
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(mockSubmit).toHaveBeenCalledTimes(1);
});

it('submits the reviewed module and reports success without changing its public payload', async () => {
  render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  fireEvent.click(confirmation());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  expect(mockSubmit.mock.calls[0][0]).toMatchObject({
    accountAddress: address('1'),
    accountId: 0,
    executions: [
      { data: '0xinstall', target: address('1'), value: '0x0' },
      { data: '0xrotate', target: address('1'), value: '0x0' },
    ],
  });
});

it('does not resubmit an already confirmed installation when saving local metadata fails', async () => {
  mockEmitter.mockImplementation(async (method: string[]) => {
    if (method[1] === 'hydrateSmartAccount') return metadata('1');
    if (method[1] === 'addSmartAccountCustomModule')
      throw new Error('Local metadata save failed');
    return { ok: true, failures: [], compositeCompatible: true };
  });
  render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  fireEvent.click(confirmation());
  await screen.findByText('smartAccountHub.moduleMetadataSaveFailed');
  expect(confirmation().disabled).toBe(true);
  fireEvent.click(confirmation());
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  expect(window.close).not.toHaveBeenCalled();
});

it('allows a new user attempt after a failed signature without a confirmed submission', async () => {
  mockSubmit.mockRejectedValueOnce(new Error('Synthetic signature cancelled'));
  render(<SmartAccountModuleConsent />);
  await waitReady();
  acknowledge();
  fireEvent.click(confirmation());
  await screen.findByText('Synthetic signature cancelled');
  expect(confirmation().disabled).toBe(false);
  fireEvent.click(confirmation());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockSubmit).toHaveBeenCalledTimes(2);
});
