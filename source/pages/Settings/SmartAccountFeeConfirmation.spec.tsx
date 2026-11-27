/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';

import { projectLocale } from '../../config/loaders/localeProjection';

import { useSmartAccountFeeConfirmation } from './SmartAccountFeeConfirmation';
import { SmartAccountInfrastructure } from './SmartAccountInfrastructure';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';
let mockAccount = ACCOUNT;
let mockCurrent = true;
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), warning: jest.fn() };
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert }),
}));
const submitted = jest.fn();
const quote = (id = 'fee-one', extra: object = {}) => ({
  id,
  maximumFeeUnits: '21000000000000',
  maximumTotalUnits: '100021000000000000',
  validForMs: 90000,
  transaction: {
    from: PAYER,
    to: TARGET,
    chainId: '31337',
    nonce: '0',
    value: '100000000000000000',
    gasLimit: '21000',
    type: 0,
    gasPrice: '1000000000',
    data: '0x',
  },
  ...extra,
});
const status = {
  chainId: 31337,
  ready: false,
  create2Deployer: { deployed: true },
  contracts: [
    { id: 'one', displayName: 'One', deployed: false },
    { id: 'two', displayName: 'Two', deployed: false },
  ],
};
jest.mock('react-redux', () => ({
  useSelector: (read: any) =>
    read({
      vault: {
        activeNetwork: {
          chainId: 31337,
          url: 'https://local.test',
          currency: 'ETH',
        },
        activeAccount: { id: 1, type: 'SmartAccount' },
        accounts: { SmartAccount: { 1: { address: mockAccount } } },
        isBitcoinBased: false,
      },
      vaultGlobal: { networkStatus: 'idle', isSwitchingAccount: false },
    }),
}));
let mockTranslate: (key: string, options?: any) => string = (key) => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    connectionUnavailable: false,
  }),
}));
jest.mock('components/index', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, variant, ...props }: any) => (
    <button data-variant={variant} {...props}>
      {children}
    </button>
  ),
  ConfirmationModal: ({
    show,
    title,
    children,
    buttonText,
    onClick,
    onClose,
  }: any) =>
    show ? (
      <div role="dialog" aria-label={title}>
        {children}
        <button onClick={onClose}>Cancel</button>
        <button onClick={onClick}>{buttonText}</button>
      </div>
    ) : null,
}));
function Harness({
  scope = 'one',
  value = quote(),
  entryPoint = false,
  executionPayer = false,
  signal,
  symbol = 'ETH',
}: {
  entryPoint?: boolean;
  executionPayer?: boolean;
  scope?: string;
  signal?: AbortSignal;
  symbol?: string;
  value?: any;
}) {
  const { confirmFee, feeConfirmation, forExecution } =
    useSmartAccountFeeConfirmation(scope);
  return (
    <>
      <button
        onClick={async () => {
          try {
            const details = {
              account: ACCOUNT,
              chainId: 31337,
              symbol,
              label: 'Recovery',
              signal,
              assertCurrent() {
                if (!mockCurrent) throw Error('Changed');
              },
            };
            const id = entryPoint
              ? await forExecution(details).confirmEntryPoint(value)
              : executionPayer
              ? await forExecution(details).confirmFee(
                  value,
                  signal ?? new AbortController().signal
                )
              : await confirmFee(value, details);
            if (id) submitted(id);
          } catch {
            submitted('refused');
          }
        }}
      >
        Prepare
      </button>
      {feeConfirmation}
    </>
  );
}
beforeEach(() => {
  mockTranslate = (key: string) => key;
  mockAccount = ACCOUNT;
  mockCurrent = true;
  submitted.mockReset();
  mockEmitter.mockReset();
  mockEmitter.mockImplementation(async ([, method]: string[]) =>
    method === 'getSmartAccountInfrastructureStatus'
      ? status
      : { feeReview: quote(), contractName: 'Factory' }
  );
});

it.each(['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'])(
  '%s translates covered fee and expiry from actual extension base resources',
  async (language) => {
    jest.useFakeTimers();
    const resource = jest.requireActual(
      `../../assets/locales/${language}.json`
    );
    const instance = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: false,
      initImmediate: false,
      resources: {
        [language]: { translation: projectLocale(resource, 'base') },
      },
    });
    mockTranslate = (key, options) => String(instance.t(key, options));
    render(
      <Harness
        value={quote('covered', {
          coveredFeeUnits: '10000000000000',
          maximumTotalUnits: '100011000000000000',
        })}
      />
    );
    fireEvent.click(screen.getByText('Prepare'));
    const dialog = screen.getByRole('dialog');
    expect(
      screen.getByText(
        resource.mobile.recoveryStatusViews.operation.maximumNetworkFeeGasTank
      )
    ).toBeTruthy();
    expect(dialog.textContent).toContain('0.00001 ETH');
    expect(dialog.textContent).not.toMatch(/(?:mobile|transactions|buttons)\./);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(90000);
    });
    expect(screen.getByRole('status').textContent).toBe(
      resource.mobile.infrastructure.reviewExpired
    );
    fireEvent.click(screen.getByText(resource.buttons.close));
    expect(submitted).not.toHaveBeenCalled();
  }
);
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

it.each([false, true])(
  'displays a lowercase configured gas symbol consistently without changing the reviewed fee (EntryPoint=%s)',
  async (entryPoint) => {
    const value = entryPoint
      ? {
          executionContextId: 'initial',
          maximumFeeWei: '21000000000000',
          gasUnits: '21000',
        }
      : quote('payer', {
          coveredFeeUnits: '10000000000000',
          maximumTotalUnits: '100011000000000000',
        });
    render(
      <Harness
        entryPoint={entryPoint}
        executionPayer={!entryPoint}
        symbol="eth"
        value={value}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Prepare' }));
    expect(screen.getByText('0.000021 ETH')).toBeTruthy();
    if (!entryPoint) {
      expect(screen.getByText('0.00001 ETH')).toBeTruthy();
      expect(screen.getByText('0.100011 ETH')).toBeTruthy();
    }
    expect(screen.queryByText(/\beth$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
    await waitFor(() =>
      expect(submitted).toHaveBeenCalledWith(entryPoint ? 'initial' : 'payer')
    );
  }
);

it('warns that declining the actual payer fee does not revoke an already signed instruction', async () => {
  render(<Harness executionPayer />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare' }));
  expect(
    screen.getByText('transactions.smartAccountAuthorizationRetained')
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(submitted).not.toHaveBeenCalled();
});

it('keeps the signed-instruction warning out of unsigned recovery and initial EntryPoint reviews', () => {
  const view = render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Prepare' }));
  expect(
    screen.queryByText('transactions.smartAccountAuthorizationRetained')
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  view.rerender(
    <Harness
      entryPoint
      value={{
        executionContextId: 'initial',
        maximumFeeWei: '123',
        gasUnits: '1',
      }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prepare' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(
    screen.queryByText('transactions.smartAccountAuthorizationRetained')
  ).toBeNull();
});

test('displays selected account separately from actual payer and preserves exact fee and total', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Prepare'));
  await screen.findByRole('dialog');
  expect(screen.getByText(ACCOUNT)).toBeTruthy();
  expect(screen.getByText(PAYER)).toBeTruthy();
  expect(screen.getByText(TARGET)).toBeTruthy();
  expect(screen.getByText('31337')).toBeTruthy();
  expect(screen.getByText('0.000021 ETH')).toBeTruthy();
  expect(screen.getByText('0.100021 ETH')).toBeTruthy();
  expect(submitted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('buttons.confirm'));
  fireEvent.click(screen.getByText('Prepare'));
  await waitFor(() => expect(submitted).toHaveBeenCalledWith('fee-one'));
  expect(submitted.mock.calls.filter(([id]) => id === 'fee-one')).toHaveLength(
    1
  );
});

test.each([
  ['21000000000000', '0.1 ETH'],
  ['10000000000000', '0.100011 ETH'],
])(
  'preserves the trusted %s gas-tank coverage in the exact payer total',
  async (coveredFeeUnits, totalText) => {
    render(
      <Harness
        value={quote('covered', {
          coveredFeeUnits,
          maximumTotalUnits: (
            BigInt('21000000000000') -
            BigInt(coveredFeeUnits) +
            BigInt('100000000000000000')
          ).toString(),
        })}
      />
    );
    fireEvent.click(screen.getByText('Prepare'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      'settings.smartAccountFeeReviewGasTank'
    );
    expect(screen.getByText(totalText)).toBeTruthy();
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('buttons.confirm'));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith('covered'));
  }
);

test.each([
  { coveredFeeUnits: '-1' },
  { coveredFeeUnits: '21000000000001' },
  { coveredFeeUnits: '1e3' },
  { coveredFeeUnits: 0 },
  {
    coveredFeeUnits: '10000000000000',
    maximumTotalUnits: '100021000000000000',
  },
])(
  'rejects invalid or inconsistent fee coverage before approval: %j',
  async (extra) => {
    render(<Harness value={quote('invalid-coverage', extra)} />);
    fireEvent.click(screen.getByText('Prepare'));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith('refused'));
    expect(screen.queryByRole('dialog')).toBeNull();
  }
);

test('reviews the EntryPoint charge separately without presenting it as the outer transaction total', async () => {
  render(
    <Harness
      entryPoint
      value={{
        executionContextId: 'prepared-operation',
        feePayer: { address: PAYER, id: 0, type: 'HDAccount' },
        gasUnits: '21000',
        maximumFeeWei: '21000000000000',
      }}
    />
  );
  fireEvent.click(screen.getByText('Prepare'));
  await screen.findByRole('dialog');
  expect(screen.getByText('send.smartAccountMaxFee')).toBeTruthy();
  expect(screen.getByText('send.smartAccountFeeDetails')).toBeTruthy();
  expect(screen.getByText('0.000021 ETH')).toBeTruthy();
  expect(
    screen.queryByText('settings.smartAccountFeeReviewMaximumTotal')
  ).toBeNull();
  expect(screen.queryByText(PAYER)).toBeNull();
  expect(submitted).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('buttons.confirm'));
  await waitFor(() =>
    expect(submitted).toHaveBeenCalledWith('prepared-operation')
  );
});

test('a retired owned Port closes its pending fee dialog without authorizing it', async () => {
  const lifetime = new AbortController();
  render(<Harness signal={lifetime.signal} />);
  fireEvent.click(screen.getByText('Prepare'));
  await screen.findByRole('dialog');
  act(() => lifetime.abort());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(submitted).not.toHaveBeenCalled();
});

test.each(['cancel', 'scope', 'unmount', 'guard', 'expiry'])(
  '%s cannot authorize the pending fee',
  async (reason) => {
    jest.useFakeTimers();
    const view = render(<Harness />);
    fireEvent.click(screen.getByText('Prepare'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    if (reason === 'cancel') fireEvent.click(screen.getByText('Cancel'));
    else if (reason === 'scope') view.rerender(<Harness scope="other" />);
    else if (reason === 'unmount') view.unmount();
    else if (reason === 'guard') {
      mockCurrent = false;
      fireEvent.click(screen.getByText('buttons.confirm'));
    } else {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(90000);
      });
      expect(screen.getByRole('status').textContent).toBe(
        'send.feeReviewExpired'
      );
      fireEvent.click(screen.getByText('buttons.close'));
    }
    await act(async () => undefined);
    expect(submitted).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  }
);

test.each([
  { maximumFeeUnits: '1' },
  { maximumTotalUnits: '1' },
  { validForMs: 0 },
  { validForMs: 90001 },
  { transaction: { ...quote().transaction, chainId: '1' } },
])(
  'rejects mismatched or expired review data before displaying consent: %j',
  async (extra) => {
    render(<Harness value={quote('bad', extra)} />);
    fireEvent.click(screen.getByText('Prepare'));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith('refused'));
    expect(screen.queryByRole('dialog')).toBeNull();
  }
);

const deployCalls = () =>
  mockEmitter.mock.calls.filter(
    ([[, method]]) => method === 'deploySmartAccountInfrastructure'
  );
async function openDeployment() {
  const view = render(<SmartAccountInfrastructure />);
  const deploy = await screen.findByText(
    'settings.deploySmartAccountInfrastructure'
  );
  await waitFor(() =>
    expect((deploy as HTMLButtonElement).disabled).toBe(false)
  );
  fireEvent.click(deploy);
  await screen.findByRole('dialog');
  return view;
}
test('infrastructure requires explicit approval of each returned transaction', async () => {
  let stage = 0;
  mockEmitter.mockImplementation(async ([, method]: string[]) =>
    method === 'getSmartAccountInfrastructureStatus'
      ? status
      : ++stage === 1
      ? { feeReview: quote(), contractName: 'Factory' }
      : stage === 2
      ? { feeReview: quote('fee-two'), contractName: 'Validator' }
      : { deployed: ['one', 'two'], skipped: [] }
  );
  await openDeployment();
  expect(deployCalls()).toHaveLength(1);
  expect(deployCalls()[0][1]).toEqual([]);
  expect(screen.getByText('Factory')).toBeTruthy();
  fireEvent.click(screen.getByText('buttons.confirm'));
  await screen.findByText('Validator');
  expect(deployCalls()).toHaveLength(2);
  expect(deployCalls()[1][1]).toEqual([{ feeReviewId: 'fee-one' }]);
  fireEvent.click(screen.getByText('buttons.confirm'));
  await waitFor(() => expect(deployCalls()).toHaveLength(3));
  expect(deployCalls()[2][1]).toEqual([{ feeReviewId: 'fee-two' }]);
});
test.each(['cancel', 'account'])(
  'infrastructure %s performs no financial submission',
  async (reason) => {
    const view = await openDeployment();
    expect(deployCalls()).toHaveLength(1);
    if (reason === 'cancel') fireEvent.click(screen.getByText('Cancel'));
    else {
      mockAccount = TARGET;
      view.rerender(<SmartAccountInfrastructure />);
    }
    await act(async () => undefined);
    expect(deployCalls()).toHaveLength(1);
  }
);

test.each([
  [
    'insufficient funds for gas',
    'error',
    'settings.smartAccountInfrastructureInsufficientGas',
  ],
  [
    'transport failed',
    'warning',
    'settings.smartAccountInfrastructureCheckBeforeRetry',
  ],
] as const)(
  'alerts on deployment failure after fee approval: %s',
  async (error, severity, message) => {
    await openDeployment();
    mockEmitter.mockRejectedValueOnce(new Error(error));
    fireEvent.click(screen.getByText('buttons.confirm'));
    await waitFor(() =>
      expect(mockAlert[severity]).toHaveBeenCalledWith(message)
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(message)).toBeNull();
    expect(deployCalls()).toHaveLength(2);
    expect(
      screen.getByText('settings.smartAccountInfrastructureCheckStatus')
    ).toBeTruthy();
  }
);
