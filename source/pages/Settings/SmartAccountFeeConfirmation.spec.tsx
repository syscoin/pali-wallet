/** @jest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { useSmartAccountFeeConfirmation } from './SmartAccountFeeConfirmation';
import { SmartAccountInfrastructure } from './SmartAccountInfrastructure';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';
let mockAccount = ACCOUNT;
let mockCurrent = true;
const mockEmitter = jest.fn();
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
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
}: {
  scope?: string;
  value?: any;
}) {
  const { confirmFee, feeConfirmation } = useSmartAccountFeeConfirmation(scope);
  return (
    <>
      <button
        onClick={async () => {
          try {
            const id = await confirmFee(value, {
              account: ACCOUNT,
              chainId: 31337,
              symbol: 'ETH',
              label: 'Recovery',
              assertCurrent() {
                if (!mockCurrent) throw Error('Changed');
              },
            });
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
afterEach(() => {
  cleanup();
  jest.useRealTimers();
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
        'mobile.infrastructure.reviewExpired'
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
