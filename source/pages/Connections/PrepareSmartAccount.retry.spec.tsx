/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';
import {
  encodeEcdsaValidatorInitData,
  getPaliModuleAddress,
} from 'utils/smartAccount';

import { PrepareSmartAccount } from './PrepareSmartAccount';

const mockEmitter = jest.fn();
const mockInstall = jest.fn();
let mockState: any;
let mockQuery: any;
let mockConfirm: () => Promise<void>;

jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: () => mockQuery,
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick }: any) => {
    if (children === 'buttons.confirm') mockConfirm = onClick;
    return (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    );
  },
  Card: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
}));
jest.mock('components/Loading', () => ({ PqOperationStatus: () => null }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  signAndSubmitSmartAccountExecutions: (params: any) => mockInstall(params),
}));

const CHAIN_ID = 57057;
const OWNER = '0x1111111111111111111111111111111111111111';
const REQUESTED_OWNER = '0x5555555555555555555555555555555555555555';
const ADDRESSES = [
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
];
const validator = getPaliModuleAddress(CHAIN_ID, 'ecdsa');
const metadata = {
  auth: {
    module: 'ecdsa',
    validator,
    data: encodeEcdsaValidatorInitData([OWNER], 1),
  },
  chainId: CHAIN_ID,
  isDeployed: false,
  installedModules: [
    {
      id: 'ecdsa',
      address: validator,
      type: 'validator',
      config: { owners: [OWNER], threshold: 1 },
    },
  ],
};
let allocated: Array<{
  address: string;
  id: number;
  smartAccount: typeof metadata;
}>;
let funded: Set<number>;
let allocationFailures: number;
let registrationFailures: number;
let hydrationFailures: number;
let connectionFailures: number;
let hydratedMetadata: any;

const adoptedMetadata = () => {
  const config = mockQuery.request.authenticator.config;
  const data = encodeEcdsaValidatorInitData(config.owners, config.threshold);
  return {
    ...metadata,
    isDeployed: true,
    auth: { module: 'ecdsa', validator, data },
    installedModules: [
      { id: 'ecdsa', address: validator, type: 'validator', config, data },
    ],
  };
};

const calls = (method: string) =>
  mockEmitter.mock.calls.filter(([[, name]]) => name === method);
const confirm = () => screen.getByRole('button', { name: 'buttons.confirm' });

beforeEach(() => {
  jest.clearAllMocks();
  allocated = [];
  funded = new Set();
  allocationFailures = 0;
  registrationFailures = 0;
  hydrationFailures = 0;
  connectionFailures = 0;
  hydratedMetadata = undefined;
  mockQuery = {
    approvalId: 'prepare-retry-approval',
    host: 'https://prepare-retry.invalid',
    eventName: 'wallet_prepareSmartAccount',
    request: {
      label: 'Synthetic retry account',
      authenticator: {
        id: 'ecdsa',
        config: { owners: [OWNER], threshold: 1 },
      },
    },
  };
  mockState = {
    vault: {
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      accounts: {
        HDAccount: {
          0: { id: 0, address: OWNER },
          1: { id: 1, address: REQUESTED_OWNER },
        },
        SmartAccount: {},
      },
      activeNetwork: {
        kind: 'ethereum',
        chainId: CHAIN_ID,
        url: 'https://synthetic-rpc.invalid',
      },
    },
  };
  // Component-boundary fixtures mirror the real allocator contract: every
  // successful create allocates/persists/selects the next distinct account.
  // No wallet controller, browser state, signature or chain operation runs.
  mockEmitter.mockReset().mockImplementation(async ([, method], params) => {
    if (method === 'createSmartAccount') {
      if (allocationFailures > 0) {
        allocationFailures -= 1;
        throw new Error('Web3 provider not available');
      }
      const id = allocated.length + 1;
      const account = {
        id,
        address: ADDRESSES[id - 1],
        smartAccount: metadata,
      };
      allocated.push(account);
      mockState.vault.accounts.SmartAccount[id] = account;
      mockState.vault.activeAccount = {
        id,
        type: KeyringAccountType.SmartAccount,
      };
      return account;
    }
    if (method === 'getSmartAccountNativeGasStatus')
      return {
        balance: funded.has(params[0].accountId) ? '1000000000' : '0',
        requiredBalance: '1000000000',
        gasUnitsReserve: '100000',
        hasNativeGas: funded.has(params[0].accountId),
        hasZkSysGasTankGas: false,
      };
    if (method === 'registerSmartAccountOnChain' && registrationFailures-- > 0)
      throw Object.assign(new Error('Deployment status read unavailable'), {
        transactionNotBroadcast: true,
      });
    if (method === 'hydrateSmartAccount' && hydrationFailures-- > 0)
      throw new Error('Hydration read unavailable');
    if (method === 'hydrateSmartAccount')
      return hydratedMetadata ?? adoptedMetadata();
    if (method === 'connect' && connectionFailures-- > 0)
      throw new Error('Connection persistence unavailable');
    if (
      method === 'setAccount' ||
      method === 'registerSmartAccountOnChain' ||
      method === 'hydrateSmartAccount' ||
      method === 'connect'
    )
      return undefined;
    throw new Error(`Unexpected fixture method: ${method}`);
  });
  mockInstall.mockReset().mockImplementation(async (params) => {
    await params.onBeforeSubmit();
    return { hash: `0x${'44'.repeat(32)}` };
  });
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});

it('reuses an admitted account after an explicitly not-broadcast registration failure', async () => {
  registrationFailures = 1;
  funded.add(1);
  render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await screen.findByText('Deployment status read unavailable');
  fireEvent.click(confirm());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(calls('createSmartAccount')).toHaveLength(1);
  expect(
    calls('registerSmartAccountOnChain').map(([, params]) => params)
  ).toEqual([[{ accountId: 1 }], [{ accountId: 1 }]]);
  expect(mockInstall).toHaveBeenCalledTimes(1);
});

it.each([undefined, false, 'hash'])(
  'does not repeat registration after an ambiguous failure (%s)',
  async (outcome) => {
    funded.add(1);
    const original = mockEmitter.getMockImplementation()!;
    mockEmitter.mockImplementation(async (path, params) => {
      if (path[1] === 'registerSmartAccountOnChain')
        throw Object.assign(new Error('Registration outcome unknown'), {
          ...(outcome === 'hash'
            ? { hash: `0x${'77'.repeat(32)}` }
            : { transactionNotBroadcast: outcome }),
        });
      return original(path, params);
    });
    render(<PrepareSmartAccount />);
    const retained = mockConfirm;
    fireEvent.click(confirm());
    await screen.findByText('send.submissionStatusUnknown');
    expect(confirm().hasAttribute('disabled')).toBe(true);
    await act(async () => retained());
    expect(calls('createSmartAccount')).toHaveLength(1);
    expect(calls('registerSmartAccountOnChain')).toHaveLength(1);
    expect(mockInstall).not.toHaveBeenCalled();
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  }
);

it.each([
  'undeployed',
  'chain',
  'auth-id',
  'auth-address',
  'missing-module',
  'module-type',
  'module-address',
  'module-data',
  'owners',
  'threshold',
])(
  'requires fresh adoption proof after outer confirmation (%s), retrying reads without reinstalling',
  async (mismatch) => {
    funded.add(1);
    mockQuery.request.authenticator.config.owners = [REQUESTED_OWNER];
    const adopted = adoptedMetadata();
    hydratedMetadata = {
      ...adopted,
      auth: { ...adopted.auth },
      installedModules: adopted.installedModules.map((module: any) => ({
        ...module,
        config: { ...module.config },
      })),
    };
    const module = hydratedMetadata.installedModules[0];
    if (mismatch === 'undeployed') hydratedMetadata.isDeployed = false;
    if (mismatch === 'chain') hydratedMetadata.chainId = CHAIN_ID + 1;
    if (mismatch === 'auth-id') hydratedMetadata.auth.module = 'slh-dsa';
    if (mismatch === 'auth-address') hydratedMetadata.auth.validator = OWNER;
    if (mismatch === 'missing-module') hydratedMetadata.installedModules = [];
    if (mismatch === 'module-type') module.type = 'executor';
    if (mismatch === 'module-address') module.address = OWNER;
    if (mismatch === 'module-data') module.data = '0x';
    if (mismatch === 'owners') {
      module.config.owners = [OWNER];
      module.data = encodeEcdsaValidatorInitData([OWNER], 1);
      hydratedMetadata.auth.data = module.data;
    }
    if (mismatch === 'threshold') module.config.threshold = 2;
    render(<PrepareSmartAccount />);
    fireEvent.click(confirm());
    await screen.findByText('connections.smartAccountPrepareFailed');
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(calls('connect')).toHaveLength(0);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    expect(confirm().hasAttribute('disabled')).toBe(false);
    hydratedMetadata = adopted;
    fireEvent.click(confirm());
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(calls('hydrateSmartAccount')).toHaveLength(2);
    expect(calls('createSmartAccount')).toHaveLength(1);
    expect(calls('registerSmartAccountOnChain')).toHaveLength(1);
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  }
);

it('accepts the same ECDSA owner policy in a different checksummed order after rotation', async () => {
  funded.add(1);
  mockQuery.request.authenticator.config = {
    owners: [OWNER, REQUESTED_OWNER],
    threshold: 2,
  };
  const adopted = adoptedMetadata();
  const data = encodeEcdsaValidatorInitData([REQUESTED_OWNER, OWNER], 2);
  hydratedMetadata = {
    ...adopted,
    auth: { ...adopted.auth, data },
    installedModules: [
      {
        ...adopted.installedModules[0],
        config: { owners: [REQUESTED_OWNER, OWNER], threshold: 2 },
        data,
      },
    ],
  };
  render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it.each(['hydrate', 'connect'])(
  'retries %s after confirmed installation without replacing the account or reinstalling',
  async (phase) => {
    hydrationFailures = phase === 'hydrate' ? 1 : 0;
    connectionFailures = phase === 'connect' ? 1 : 0;
    funded.add(1);
    render(<PrepareSmartAccount />);
    fireEvent.click(confirm());
    await screen.findByText(
      phase === 'hydrate'
        ? 'Hydration read unavailable'
        : 'Connection persistence unavailable'
    );
    expect(mockInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(confirm());
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(calls('createSmartAccount')).toHaveLength(1);
    expect(calls('registerSmartAccountOnChain')).toHaveLength(1);
    expect(mockInstall).toHaveBeenCalledTimes(1);
    expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  }
);

it('does not replay an installation whose submission outcome is unknown', async () => {
  funded.add(1);
  mockInstall.mockImplementationOnce(async (params) => {
    await params.onBeforeSubmit();
    throw new Error('Network request timed out');
  });
  render(<PrepareSmartAccount />);
  const retained = mockConfirm;
  fireEvent.click(confirm());
  await screen.findByText('send.submissionStatusUnknown');
  expect(confirm().hasAttribute('disabled')).toBe(true);
  await act(async () => retained());
  expect(calls('createSmartAccount')).toHaveLength(1);
  expect(mockInstall).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it.each(['signing', 'not-broadcast'])(
  'permits retry after a known %s installation failure',
  async (failure) => {
    funded.add(1);
    mockInstall.mockImplementationOnce(async (params) => {
      if (failure === 'signing')
        throw Object.assign(new Error('Known pre-submit failure'), {
          code: 4001,
        });
      await params.onBeforeSubmit();
      throw Object.assign(new Error('Known pre-submit failure'), {
        transactionNotBroadcast: true,
      });
    });
    render(<PrepareSmartAccount />);
    fireEvent.click(confirm());
    await screen.findByText('Known pre-submit failure');
    fireEvent.click(confirm());
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(calls('createSmartAccount')).toHaveLength(1);
    expect(mockInstall).toHaveBeenCalledTimes(2);
  }
);

it('claims approval synchronously and keeps a completed approval terminal', async () => {
  funded.add(1);
  let finish!: () => void;
  mockInstall.mockImplementationOnce(async (params) => {
    await params.onBeforeSubmit();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  render(<PrepareSmartAccount />);
  const retained = mockConfirm;
  let first!: Promise<void>;
  await act(async () => {
    first = retained();
    await retained();
  });
  await waitFor(() => expect(finish).toBeDefined());
  expect(calls('createSmartAccount')).toHaveLength(1);
  await act(async () => {
    finish();
    await first;
  });
  await act(async () => retained());
  expect(mockInstall).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it.each(['request', 'host', 'endpoint', 'wallet'])(
  'retires the old admitted account when the %s scope changes',
  async (change) => {
    const view = render(<PrepareSmartAccount />);
    fireEvent.click(confirm());
    await screen.findByText('send.insufficientFundsForGas');
    const retained = mockConfirm;
    if (change === 'request')
      mockQuery = {
        ...mockQuery,
        approvalId: 'replacement-approval',
        request: { ...mockQuery.request, label: 'New request' },
      };
    if (change === 'host')
      mockQuery = { ...mockQuery, host: 'https://replacement.invalid' };
    if (change === 'endpoint')
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://replacement-rpc.invalid',
      };
    if (change === 'wallet')
      mockState.vault.accounts.HDAccount[0] = {
        ...mockState.vault.accounts.HDAccount[0],
        xpub: 'replacement-public-root',
      };
    funded.add(2);
    view.rerender(<PrepareSmartAccount />);
    await act(async () => retained());
    expect(calls('createSmartAccount')).toHaveLength(1);
    fireEvent.click(confirm());
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(allocated.map(({ id }) => id)).toEqual([1, 2]);
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      `${mockQuery.eventName}.${mockQuery.host}`,
      expect.objectContaining({ address: ADDRESSES[1] })
    );
  }
);

it('retires an admitted account on unmount and leaves retained callbacks inert', async () => {
  const view = render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await screen.findByText('send.insufficientFundsForGas');
  const retained = mockConfirm;
  view.unmount();
  await act(async () => retained());
  expect(calls('createSmartAccount')).toHaveLength(1);
  funded.add(2);
  render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(allocated.map(({ id }) => id)).toEqual([1, 2]);
});

it.each(['endpoint', 'unmount'])(
  'does not continue an old pending gas read after %s departure',
  async (departure) => {
    const original = mockEmitter.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    mockEmitter.mockImplementation((method, params) => {
      if (
        method[1] === 'getSmartAccountNativeGasStatus' &&
        params[0].accountId === 1
      )
        return new Promise((resolve) => {
          finish = resolve;
        });
      return original(method, params);
    });
    const view = render(<PrepareSmartAccount />);
    fireEvent.click(confirm());
    await waitFor(() => expect(finish).toBeDefined());
    if (departure === 'endpoint') {
      mockState.vault.activeNetwork = {
        ...mockState.vault.activeNetwork,
        url: 'https://new-pending-context.invalid',
      };
      view.rerender(<PrepareSmartAccount />);
    } else view.unmount();
    await act(async () =>
      finish({ hasNativeGas: true, hasZkSysGasTankGas: false })
    );
    expect(mockInstall).not.toHaveBeenCalled();
    expect(calls('connect')).toHaveLength(0);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    funded.add(2);
    if (departure === 'unmount') render(<PrepareSmartAccount />);
    fireEvent.click(confirm());
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
    expect(allocated.map(({ id }) => id)).toEqual([1, 2]);
  }
);
afterEach(() => jest.restoreAllMocks());

it('completes a healthy first attempt using the allocated account and exact public response', async () => {
  funded.add(1);
  render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(allocated.map(({ id }) => id)).toEqual([1]);
  expect(mockInstall).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 1,
      accountAddress: ADDRESSES[0],
    })
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'wallet_prepareSmartAccount.https://prepare-retry.invalid',
    { address: ADDRESSES[0], chainId: '0xdee1', installedValidator: validator }
  );
});

it('allows an explicit fresh allocation after failure before any account was returned', async () => {
  allocationFailures = 1;
  funded.add(1);
  render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await screen.findByText('Web3 provider not available');
  expect(allocated).toHaveLength(0);
  expect(confirm().hasAttribute('disabled')).toBe(false);
  fireEvent.click(confirm());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(calls('createSmartAccount')).toHaveLength(2);
  expect(allocated.map(({ id }) => id)).toEqual([1]);
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('resumes the same admitted account after the known gas error is corrected instead of allocating another address', async () => {
  render(<PrepareSmartAccount />);
  fireEvent.click(confirm());
  await screen.findByText('send.insufficientFundsForGas');
  expect(allocated.map(({ id }) => id)).toEqual([1]);
  expect(confirm().hasAttribute('disabled')).toBe(false);
  expect(mockInstall).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  // The user funds the exact already-created account after the known gas
  // failure. A second freshly allocated address deliberately remains empty.
  funded.add(1);
  fireEvent.click(confirm());
  await waitFor(() =>
    expect(calls('getSmartAccountNativeGasStatus')).toHaveLength(2)
  );
  expect(calls('createSmartAccount')).toHaveLength(1);
  expect(allocated.map(({ id }) => id)).toEqual([1]);
  expect(calls('registerSmartAccountOnChain')).toHaveLength(1);
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockInstall).toHaveBeenCalledWith(
    expect.objectContaining({
      accountId: 1,
      accountAddress: ADDRESSES[0],
    })
  );
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'wallet_prepareSmartAccount.https://prepare-retry.invalid',
    expect.objectContaining({ address: ADDRESSES[0] })
  );
});
